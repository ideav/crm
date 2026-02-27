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

            // Check URL parameters for parentId and recordId (issue #563)
            const urlParams = new URLSearchParams(window.location.search);
            const urlParentId = urlParams.get('parentId') || urlParams.get('F_U') || urlParams.get('up');
            const urlRecordId = urlParams.get('F_I');  // Record ID filter from URL (issue #563)

            this.options = {
                apiUrl: options.apiUrl || '',
                pageSize: options.pageSize || 20,
                cookiePrefix: options.cookiePrefix || 'integram-table',
                title: options.title || '',
                instanceName: options.instanceName || 'table',
                onCellClick: options.onCellClick || null,
                onDataLoad: options.onDataLoad || null,
                // New options for dual data source support
                dataSource: options.dataSource || 'report',  // 'report' or 'table'
                tableTypeId: options.tableTypeId || null,   // Required for dataSource='table'
                parentId: options.parentId || urlParentId || null,  // Parent ID for table data source
                recordId: options.recordId || urlRecordId || null,  // Record ID filter for table data source (issue #563)
                debug: options.debug || false  // Enable debug tracing
            };

            // Set global debug flag if enabled
            if (this.options.debug) {
                window.INTEGRAM_DEBUG = true;
            }

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
            this.objectTableId = null;  // Table ID when data is in object/JSON_OBJ format (for _count=1 queries)
            this.rawObjectData = [];  // Raw data array with {i, u, o, r} for object format (preserves record IDs)
            this.styleColumns = {};  // Map of column IDs to their style column values
            this.idColumns = new Set();  // Set of hidden ID column IDs
            this.columnWidths = {};  // Map of column IDs to their widths in pixels
            this.metadataCache = {};  // Cache for metadata by type ID
            this.editableColumns = new Map();  // Map of column IDs to their corresponding ID column IDs
            this.checkboxMode = false;  // Whether checkbox selection column is visible
            this.selectedRows = new Set();  // Set of selected row indices
            this.globalMetadata = null;  // Global metadata for determining parent relationships
            this.currentEditingCell = null;  // Track currently editing cell
            this.pendingCellClick = null;  // Track pending cell click for focus preservation (issue #518)
            this.sortColumn = null;  // Column ID being sorted (null = no sort)
            this.sortDirection = null;  // 'asc' or 'desc' (null = no sort)

            // Parent info for displaying breadcrumb-like title (issue #571)
            this.parentInfo = null;  // { id, val, typ, typ_name } from edit_obj/{parentId}?JSON

            // Grouping mode (issue #502)
            this.groupingEnabled = false;  // Whether grouping mode is active
            this.groupingColumns = [];  // Array of column IDs to group by, in order
            this.groupedData = [];  // Processed data with grouping information

            // Track URL parameters that have been overridden by user filters (issue #500)
            // When a user sets a filter for a field that came as a GET parameter,
            // we remove it from URL and stop forwarding it to API requests
            this.overriddenUrlParams = new Set();

            // Track URL filter parameters (FR_*, TO_*, F_*) for issue #547, #549
            // These are parsed from URL and displayed in the filter row
            this.urlFilters = {};  // Map of column IDs to { type, value } parsed from URL params

            // Track whether configuration (column order/visibility) was loaded from URL (issue #514)
            // When true, changes to column state will NOT be saved to cookies
            // but can still be copied as a shareable URL
            this.configFromUrl = false;

            // Table settings
            this.settings = {
                compact: false,  // false = spacious (default), true = compact
                pageSize: this.options.pageSize,  // Current page size
                truncateLongValues: true  // true = truncate to 127 chars (default)
            };

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
                    { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
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

        /**
         * Map type ID (from metadata) to base format name for filters
         * Type IDs are the base data types: string, number, date
         * Format names are used to determine which filter operators are available
         */
        mapTypeIdToFormat(typeId) {
            // Convert to string for consistent comparison
            const id = String(typeId);

            // Map of type IDs to format names based on TABLE_COMPONENT_README.md
            const typeMap = {
                '3': 'SHORT',      // Short string (up to 127 chars)
                '8': 'CHARS',      // String without length limit
                '9': 'DATE',       // Date
                '13': 'NUMBER',    // Integer number
                '14': 'SIGNED',    // Number with decimal part
                '11': 'BOOLEAN',   // Boolean
                '12': 'MEMO',      // Multiline text
                '4': 'DATETIME',   // Date and time
                '10': 'FILE',      // File
                '2': 'HTML',       // HTML
                '7': 'BUTTON',     // Button
                '6': 'PWD',        // Password
                '5': 'NUMBER',     // Grant (treat as number for filters)
                '16': 'NUMBER',    // Report column (treat as number for filters)
                '17': 'CHARS'      // Path (treat as string for filters)
            };

            return typeMap[id] || 'SHORT'; // Default to SHORT if not found
        }

        init() {
            this.loadColumnState();
            this.loadSettings();
            this.loadConfigFromUrl();  // Load filters, groups, sorting from URL (issue #510)
            this.loadGlobalMetadata();  // Load metadata once at initialization
            this.loadParentInfo();  // Load parent info for breadcrumb title (issue #571)
            this.loadData();
        }

        async loadGlobalMetadata() {
            try {
                const apiBase = this.getApiBase();
                const response = await fetch(`${ apiBase }/metadata`);
                if (!response.ok) {
                    console.error('Failed to fetch global metadata');
                    return;
                }
                const metadata = await response.json();
                this.globalMetadata = metadata;
                // Re-render if data is already loaded, so column-add-btn visibility
                // can be recalculated based on the metadata ids
                if (this.columns.length > 0) {
                    this.render();
                }
            } catch (error) {
                console.error('Error loading global metadata:', error);
            }
        }

        /**
         * Load parent info when F_U filter is present and > 1 (issue #571)
         * Fetches parent record data from edit_obj/{parentId}?JSON
         * Used to display breadcrumb-like title: "{parent table name} {record value}: {current table name}"
         */
        async loadParentInfo() {
            try {
                // Only fetch parent info if parentId is numeric and > 1
                const parentId = parseInt(this.options.parentId, 10);
                if (!parentId || parentId <= 1) {
                    return;
                }

                const apiBase = this.getApiBase();
                const response = await fetch(`${ apiBase }/edit_obj/${ parentId }?JSON`);
                if (!response.ok) {
                    console.error('Failed to fetch parent info:', response.status);
                    return;
                }
                const data = await response.json();
                if (data && data.obj) {
                    this.parentInfo = {
                        id: data.obj.id,
                        val: data.obj.val,
                        typ: data.obj.typ,
                        typ_name: data.obj.typ_name
                    };
                    // Re-render if data is already loaded, so the title updates
                    if (this.columns.length > 0) {
                        this.render();
                    }
                }
            } catch (error) {
                console.error('Error loading parent info:', error);
            }
        }

        /**
         * Generate title HTML with parent info breadcrumb (issue #571)
         * Format: "{parent table name} {record value}: {current table name}"
         * Where {parent table name} links to table/{parent type id}
         * And {record value} links to table/{parent record id}
         */
        renderTitleHtml() {
            if (!this.options.title && !this.parentInfo) {
                return '';
            }

            // Extract database name from URL path for building links
            const pathParts = window.location.pathname.split('/');
            const dbName = pathParts.length >= 2 ? pathParts[1] : '';

            // If we have parent info, show breadcrumb-style title
            if (this.parentInfo) {
                const parentTypeName = this.escapeHtml(this.parentInfo.typ_name || '');
                const parentVal = this.escapeHtml(this.parentInfo.val || '');
                const parentTypeId = this.parentInfo.typ || '';
                const parentRecordId = this.parentInfo.id || '';
                const currentTitle = this.escapeHtml(this.options.title || '');

                // Build links
                const parentTypeLink = `/${ dbName }/table/${ parentTypeId }`;
                // Parent record link is now a clickable span that opens modal edit form (issue #575)

                return `<div class="integram-table-title"><a href="${ parentTypeLink }" class="integram-title-link">${ parentTypeName }</a> <span class="integram-title-link integram-parent-record-link" data-parent-record-id="${ parentRecordId }" data-parent-type-id="${ parentTypeId }" style="cursor: pointer;">${ parentVal }</span>${ currentTitle ? ': ' + currentTitle : '' }</div>`;
            }

            // No parent info, just show the title
            return `<div class="integram-table-title">${ this.escapeHtml(this.options.title) }</div>`;
        }

        async loadData(append = false) {
            if (this.isLoading || (!append && !this.hasMore && this.loadedRecords > 0)) {
                return;
            }

            this.isLoading = true;

            try {
                let json;
                let newRows = [];

                if (this.options.dataSource === 'table') {
                    // Load data from table format (object/{typeId}/?JSON_OBJ&F_U={parentId})
                    json = await this.loadDataFromTable(append);
                    newRows = json.rows || [];
                } else {
                    // Load data from report format (default behavior)
                    json = await this.loadDataFromReport(append);
                    newRows = json.rows || [];
                    // Auto-set table title from report header if not explicitly provided (issue #537)
                    if (!this.options.title && json.header) {
                        this.options.title = json.header;
                    }
                }

                this.columns = json.columns || [];

                // In grouping mode, disable infinite scroll and use all data (up to 1000)
                const isGroupingMode = this.groupingEnabled && this.groupingColumns.length > 0;

                // Check if there are more records (we requested pageSize + 1)
                // In grouping mode, we fetched up to 1000 records at once
                if (isGroupingMode) {
                    // Grouping mode: no pagination, show all fetched data
                    this.hasMore = false;
                } else {
                    this.hasMore = newRows.length > this.options.pageSize;
                }

                // Keep only pageSize records; also trim rawData to stay aligned
                // In grouping mode, keep all data (up to 1000)
                let rawData = json.rawData || [];
                if (!isGroupingMode && this.hasMore) {
                    newRows = newRows.slice(0, this.options.pageSize);
                    rawData = rawData.slice(0, this.options.pageSize);
                }

                // Append or replace data
                if (append && !isGroupingMode) {
                    this.data = this.data.concat(newRows);
                    // Append raw object data if present
                    if (rawData.length > 0) {
                        this.rawObjectData = this.rawObjectData.concat(rawData);
                    }
                } else {
                    this.data = newRows;
                    this.loadedRecords = 0;
                    // Replace raw object data if present
                    this.rawObjectData = rawData;
                }

                this.loadedRecords += newRows.length;

                // Auto-set total count if we've reached the end
                if (!this.hasMore && this.totalRows === null) {
                    this.totalRows = this.loadedRecords;
                }

                // Process grouping if enabled (issue #502)
                if (isGroupingMode) {
                    this.processGroupedData();
                }

                // Process columns to hide ID and Style suffixes
                this.processColumnVisibility();

                const currentColumnIds = new Set(this.columns.map(c => c.id));

                // Validate columnOrder against current columns; reset if stale (no matches)
                if (this.columnOrder.length === 0 || !this.columnOrder.some(id => currentColumnIds.has(id))) {
                    this.columnOrder = this.columns.map(c => c.id);
                }
                // Validate visibleColumns; reset if stale (no matches after filtering)
                const validVisible = this.visibleColumns.filter(id => currentColumnIds.has(id) && !this.idColumns.has(id));
                if (this.visibleColumns.length === 0 || validVisible.length === 0) {
                    this.visibleColumns = this.columns.filter(c => !this.idColumns.has(c.id)).map(c => c.id);
                } else {
                    this.visibleColumns = validVisible;
                }

                // Parse URL filter parameters on initial load (issue #547)
                // This must be done after columns are loaded so we can match column IDs
                if (!append && Object.keys(this.urlFilters).length === 0) {
                    this.parseUrlFiltersFromParams();
                }

                if (this.options.onDataLoad) {
                    this.options.onDataLoad(json);
                }

                this.render();
            } catch (error) {
                console.error('Error loading data:', error);
                if (!append && this.container) {
                    this.container.innerHTML = `<div class="alert alert-danger">Ошибка загрузки данных: ${ error.message }</div>`;
                }
            } finally {
                this.isLoading = false;
                // Check if table fits on screen and needs more data
                this.checkAndLoadMore();
            }
        }

        async loadDataFromReport(append = false) {
            // Original report-based data loading logic
            // In grouping mode, use LIMIT=1000 and disable scrolling (issue #502)
            const isGroupingMode = this.groupingEnabled && this.groupingColumns.length > 0;
            const requestSize = isGroupingMode ? 1000 : (this.options.pageSize + 1);
            const offset = (append && !isGroupingMode) ? this.loadedRecords : 0;

            const params = new URLSearchParams();

            // Only add LIMIT for non-metadata URLs (metadata ignores LIMIT)
            const isMetadataUrl = /\/metadata\/\d+/.test(this.options.apiUrl);
            if (!isMetadataUrl) {
                params.set('LIMIT', `${ offset },${ requestSize }`);
            }

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

            const separator = this.options.apiUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
            const json = await response.json();

            // Check if this is object format (has id, type keys but not columns, data)
            if (this.isObjectFormat(json)) {
                // Parse as object format instead
                return await this.parseObjectFormat(json, append);
            }

            // Check if response is JSON_OBJ array format: [{i, u, o, r}, ...]
            if (this.isJsonDataArrayFormat(json)) {
                return await this.parseJsonDataArray(json, append);
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

            return {
                columns: json.columns || [],
                rows: rows,
                header: json.header || null
            };
        }

        async loadDataFromTable(append = false) {
            // Table-based data loading using object/{typeId}/?JSON_OBJ&F_U={parentId}
            if (!this.options.tableTypeId) {
                throw new Error('tableTypeId is required for dataSource=table');
            }

            this.objectTableId = this.options.tableTypeId;  // Store table ID for _count=1 queries

            // In grouping mode, use LIMIT=1000 and disable scrolling (issue #502)
            const isGroupingMode = this.groupingEnabled && this.groupingColumns.length > 0;
            const requestSize = isGroupingMode ? 1000 : (this.options.pageSize + 1);
            const offset = (append && !isGroupingMode) ? this.loadedRecords : 0;

            // First load, fetch metadata to get column information
            if (this.columns.length === 0) {
                const apiBase = this.getApiBase();
                const metadataUrl = `${ apiBase }/metadata/${ this.options.tableTypeId }`;
                const metadataResponse = await fetch(metadataUrl);
                const metadata = await metadataResponse.json();

                // Auto-set table title from metadata if not explicitly provided
                if (!this.options.title && (metadata.val || metadata.value || metadata.name)) {
                    this.options.title = metadata.val || metadata.value || metadata.name;
                }

                // Convert metadata to columns format
                const columns = [];

                // Add main value column
                columns.push({
                    id: '0',
                    type: metadata.type || 'SHORT',
                    format: this.mapTypeIdToFormat(metadata.type || 'SHORT'),
                    name: metadata.name || 'Значение',
                    granted: 1,
                    ref: 0,
                    paramId: metadata.id // For cell editing: use t{metadata.id} for first column
                });

                // Add requisite columns
                if (metadata.reqs && Array.isArray(metadata.reqs)) {
                    metadata.reqs.forEach((req, idx) => {
                        const attrs = this.parseAttrs(req.attrs);
                        columns.push({
                            id: String(idx + 1),
                            type: req.type || 'SHORT',
                            format: this.mapTypeIdToFormat(req.type || 'SHORT'),
                            name: attrs.alias || req.val,
                            granted: 1,  // In object format, allow editing all cells
                            ref: req.arr_id || 0,
                            paramId: req.id // For cell editing: use t{req.id} for requisite columns
                        });
                    });
                }

                this.columns = columns;
            }

            // Build data URL with server-side LIMIT for pagination
            const apiBase = this.getApiBase();
            let dataUrl = `${ apiBase }/object/${ this.options.tableTypeId }/?JSON_OBJ&LIMIT=${ offset },${ requestSize }`;

            if (this.options.parentId) {
                dataUrl += `&F_U=${ this.options.parentId }`;
            }

            // Add record ID filter if present (issue #563)
            if (this.options.recordId) {
                dataUrl += `&F_I=${ this.options.recordId }`;
            }

            // Apply filters if any (issue #508)
            const filters = this.filters || {};
            const filterParams = new URLSearchParams();

            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        this.applyFilter(filterParams, column, filter);
                    }
                }
            });

            // Add filter parameters to URL
            if (filterParams.toString()) {
                dataUrl += `&${ filterParams.toString() }`;
            }

            // Add ORDER parameter for sorting
            if (this.sortColumn !== null && this.sortDirection !== null) {
                const orderValue = this.sortDirection === 'desc' ? `-${this.sortColumn}` : this.sortColumn;
                dataUrl += `&ORDER=${ orderValue }`;
            }

            // Forward GET parameters from page URL (issue #476)
            const pageParams = this.getPageUrlParams();
            if (pageParams.toString()) {
                dataUrl += `&${ pageParams.toString() }`;
            }

            const dataResponse = await fetch(dataUrl);
            const data = await dataResponse.json();

            // Transform table format to row format
            // Input format: [{ i: 5151, u: 333, o: 1, r: ["val1", "val2"] }]
            // Output format: [["val1", "val2"]]
            let rows = [];
            if (Array.isArray(data)) {
                rows = data.map(item => item.r || []);
            }

            return {
                columns: this.columns,
                rows: rows,
                rawData: Array.isArray(data) ? data : []  // Preserve raw data with 'i' keys for record IDs
            };
        }

        /**
         * Check if the response is in object format (metadata structure)
         * Object format has: id, type, val, reqs (optional)
         * Report format has: columns, data
         */
        isObjectFormat(json) {
            // Object format has id, type but not columns, data
            // First check if json is a valid object
            if (!json || typeof json !== 'object') {
                return false;
            }
            return json.hasOwnProperty('id') &&
                   json.hasOwnProperty('type') &&
                   !json.hasOwnProperty('columns') &&
                   !json.hasOwnProperty('data');
        }

        /**
         * Parse object format metadata and fetch data
         * Object format structure:
         * {
         *   "id": "3596",
         *   "type": "8",
         *   "val": "Задача",
         *   "reqs": [
         *     {"num": 1, "id": "3597", "val": "Описание", "type": "12", "orig": "119"},
         *     ...
         *   ]
         * }
         */
        async parseObjectFormat(metadata, append = false) {
            // Auto-set table title from metadata if not explicitly provided
            if (!this.options.title && (metadata.val || metadata.value)) {
                this.options.title = metadata.val || metadata.value;
            }

            // Convert metadata to columns format
            const columns = [];

            // First column: use metadata.id as column id (not sequential index)
            columns.push({
                id: String(metadata.id),
                type: metadata.type || 'SHORT',
                format: this.mapTypeIdToFormat(metadata.type || 'SHORT'),
                name: metadata.val || 'Значение',
                granted: 1,
                ref: 0,
                orig: metadata.id, // Store the original table id
                paramId: metadata.id // For cell editing: use t{metadata.id} for first column
            });

            // Remaining columns from reqs array: use req.id as column id (not sequential index)
            if (metadata.reqs && Array.isArray(metadata.reqs)) {
                metadata.reqs.forEach((req, idx) => {
                    const attrs = this.parseAttrs(req.attrs);
                    const isReference = req.hasOwnProperty('ref_id');

                    columns.push({
                        id: String(req.id),
                        type: req.type || 'SHORT',
                        format: this.mapTypeIdToFormat(req.type || 'SHORT'),
                        name: attrs.alias || req.val,
                        granted: 1,  // In object format, allow editing all cells
                        ref: isReference ? req.orig : 0,
                        ref_id: req.ref_id || null,
                        orig: req.orig || null,
                        attrs: req.attrs || '',
                        paramId: req.id, // For cell editing: use t{req.id} for requisite columns
                        arr_id: req.arr_id || null // For table requisites (subordinate tables)
                    });
                });
            }

            // Now fetch data using object/{id}/?JSON_OBJ endpoint
            const apiBase = this.getApiBase();
            const tableId = metadata.id;
            this.objectTableId = tableId;  // Store table ID for _count=1 queries
            // In grouping mode, use LIMIT=1000 and disable scrolling (issue #502)
            const isGroupingMode = this.groupingEnabled && this.groupingColumns.length > 0;
            const requestSize = isGroupingMode ? 1000 : (this.options.pageSize + 1);
            const offset = (append && !isGroupingMode) ? this.loadedRecords : 0;
            let dataUrl = `${ apiBase }/object/${ tableId }/?JSON_OBJ&LIMIT=${ offset },${ requestSize }`;

            // Add parent ID filter if present (issue #563)
            if (this.options.parentId) {
                dataUrl += `&F_U=${ this.options.parentId }`;
            }

            // Add record ID filter if present (issue #563)
            if (this.options.recordId) {
                dataUrl += `&F_I=${ this.options.recordId }`;
            }

            // Apply filters if any
            const filters = this.filters || {};
            const filterParams = new URLSearchParams();

            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = columns.find(c => c.id === colId);
                    if (column) {
                        this.applyFilter(filterParams, column, filter);
                    }
                }
            });

            // Add filter parameters to URL
            if (filterParams.toString()) {
                dataUrl += `&${ filterParams.toString() }`;
            }

            // Add ORDER parameter for sorting
            if (this.sortColumn !== null && this.sortDirection !== null) {
                const orderValue = this.sortDirection === 'desc' ? `-${this.sortColumn}` : this.sortColumn;
                dataUrl += `&ORDER=${ orderValue }`;
            }

            // Forward GET parameters from page URL (issue #476)
            const pageParams = this.getPageUrlParams();
            if (pageParams.toString()) {
                dataUrl += `&${ pageParams.toString() }`;
            }

            // Fetch data
            const dataResponse = await fetch(dataUrl);
            const dataArray = await dataResponse.json();

            // Transform object format data to row format
            // Input: [{ i: 5151, u: 333, o: 1, r: ["val1", "val2"] }]
            // Output: [["val1", "val2"]]
            let rows = [];
            if (Array.isArray(dataArray)) {
                rows = dataArray.map(item => item.r || []);
            }

            return {
                columns: columns,
                rows: rows,
                rawData: Array.isArray(dataArray) ? dataArray : []  // Preserve raw data with 'i' keys
            };
        }

        /**
         * Check if the response is a JSON_OBJ array format: [{i, u, o, r}, ...]
         * This format is returned by object/{typeId}/?JSON_OBJ endpoints
         */
        isJsonDataArrayFormat(json) {
            // Non-empty array with {i, r} objects
            if (Array.isArray(json) && json.length > 0 &&
                json[0].hasOwnProperty('i') &&
                json[0].hasOwnProperty('r') &&
                Array.isArray(json[0].r)) {
                return true;
            }
            // Empty array when apiUrl contains JSON_OBJ
            if (Array.isArray(json) && json.length === 0 &&
                this.options.apiUrl && this.options.apiUrl.includes('JSON_OBJ')) {
                return true;
            }
            return false;
        }

        /**
         * Parse JSON_OBJ array format and fetch metadata for column definitions
         * Input format: [{i: 3598, u: 1, o: 0, r: ["val1", "val2", ...]}, ...]
         */
        async parseJsonDataArray(dataArray, append = false) {
            // Extract typeId from the apiUrl
            // Supports multiple URL formats:
            // - /object/3596/?JSON_OBJ -> 3596
            // - /metadata/332 -> 332
            // - /crm/metadata/332 -> 332
            // - /crm/object/3596/ -> 3596
            let typeId = null;

            // Try /object/{id} pattern first
            const objectMatch = this.options.apiUrl.match(/\/object\/(\d+)/);
            if (objectMatch) {
                typeId = objectMatch[1];
            }

            // Try /metadata/{id} pattern
            if (!typeId) {
                const metadataMatch = this.options.apiUrl.match(/\/metadata\/(\d+)/);
                if (metadataMatch) {
                    typeId = metadataMatch[1];
                }
            }

            // Try to get from already stored objectTableId
            if (!typeId && this.objectTableId) {
                typeId = this.objectTableId;
            }

            // Try to extract from any /{database}/{endpoint}/{id} pattern
            if (!typeId) {
                const genericMatch = this.options.apiUrl.match(/\/(\d+)(?:\/|\?|$)/);
                if (genericMatch) {
                    typeId = genericMatch[1];
                }
            }

            if (!typeId) {
                throw new Error(`Cannot determine typeId from apiUrl: ${this.options.apiUrl}. Expected patterns: /object/{id}, /metadata/{id}, or /{id}`);
            }
            this.objectTableId = typeId;  // Store table ID for _count=1 queries

            // Fetch metadata if columns are not yet loaded
            if (this.columns.length === 0) {
                const apiBase = this.getApiBase();
                const metadataUrl = `${ apiBase }/metadata/${ typeId }`;
                const metadataResponse = await fetch(metadataUrl);
                const metadata = await metadataResponse.json();

                // Auto-set table title from metadata if not explicitly provided
                if (!this.options.title && (metadata.val || metadata.value)) {
                    this.options.title = metadata.val || metadata.value;
                }

                // Convert metadata to columns format
                const columns = [];

                // Add main value column
                columns.push({
                    id: '0',
                    type: metadata.type || 'SHORT',
                    format: this.mapTypeIdToFormat(metadata.type || 'SHORT'),
                    name: metadata.val || metadata.name || 'Значение',
                    granted: 1,
                    ref: 0,
                    orig: metadata.id,
                    paramId: metadata.id // For cell editing: use t{metadata.id} for first column
                });

                // Add requisite columns
                if (metadata.reqs && Array.isArray(metadata.reqs)) {
                    metadata.reqs.forEach((req, idx) => {
                        const attrs = this.parseAttrs(req.attrs);
                        const isReference = req.hasOwnProperty('ref_id');

                        columns.push({
                            id: String(idx + 1),
                            type: req.type || 'SHORT',
                            format: this.mapTypeIdToFormat(req.type || 'SHORT'),
                            name: attrs.alias || req.val,
                            granted: 1,  // In object format, allow editing all cells
                            ref: isReference ? req.orig : 0,
                            ref_id: req.ref_id || null,
                            orig: req.orig || null,
                            attrs: req.attrs || '',
                            paramId: req.id, // For cell editing: use t{req.id} for requisite columns
                            arr_id: req.arr_id || null // For table requisites (subordinate tables)
                        });
                    });
                }

                this.columns = columns;
            }

            // Transform JSON_OBJ array to row format
            // LIMIT is already applied server-side via the fetch URL in loadDataFromReport
            const rows = dataArray.map(item => item.r || []);

            return {
                columns: this.columns,
                rows: rows,
                rawData: dataArray  // Preserve raw data with 'i' keys
            };
        }

        async fetchTotalCount() {
            try {
                let countUrl;

                if (this.objectTableId) {
                    // Object/JSON_OBJ format: use _count=1 on the JSON_OBJ endpoint
                    const apiBase = this.getApiBase();
                    const params = new URLSearchParams({
                        _count: '1'
                    });

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

                    // Add parent filter if applicable
                    if (this.options.parentId) {
                        params.set('F_U', this.options.parentId);
                    }

                    // Forward GET parameters from page URL (issue #476)
                    this.appendPageUrlParams(params);

                    countUrl = `${ apiBase }/object/${ this.objectTableId }/?JSON_OBJ&${ params }`;
                } else {
                    // Report format: use RECORD_COUNT=1 on the report URL
                    const params = new URLSearchParams({
                        RECORD_COUNT: '1'
                    });

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

                    // Forward GET parameters from page URL (issue #476)
                    this.appendPageUrlParams(params);

                    const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                    countUrl = `${ this.options.apiUrl }${ separator }${ params }`;
                }

                const response = await fetch(countUrl);
                const result = await response.json();
                this.totalRows = parseInt(result.count, 10);
                this.render();  // Re-render to update the counter
            } catch (error) {
                console.error('Error fetching total count:', error);
            }
        }

        /**
         * Get the default filter type symbol for a given column format.
         * NUMBER, SIGNED, DATE, DATETIME use '=' (equals) by default (issue #539).
         * All other types use '^' (starts with) by default.
         */
        getDefaultFilterType(format) {
            const equalDefaultFormats = ['NUMBER', 'SIGNED', 'DATE', 'DATETIME'];
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

        render() {
            // Guard against missing container
            if (!this.container) {
                console.error('Cannot render: container element not found');
                return;
            }

            // Preserve focus state before re-rendering
            const focusedElement = document.activeElement;
            let focusState = null;

            if (focusedElement && focusedElement.classList.contains('filter-input-with-icon')) {
                focusState = {
                    columnId: focusedElement.dataset.columnId,
                    selectionStart: focusedElement.selectionStart,
                    selectionEnd: focusedElement.selectionEnd
                };
            }

            const orderedColumns = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => c && this.visibleColumns.includes(c.id));

            const instanceName = this.options.instanceName;

            let html = `
                <div class="integram-table-wrapper">
                    <div class="integram-table-header">
                        ${ this.renderTitleHtml() }
                        <div class="integram-table-controls">
                            ${ this.hasActiveFiltersOrGroups() ? `
                            <button class="btn btn-sm btn-outline-secondary me-2" onclick="window.${ instanceName }.copyConfigUrl()" title="Скопировать ссылку с текущими фильтрами и группами">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle;">
                                    <path d="M10 2H6C5.44772 2 5 2.44772 5 3V4H4C3.44772 4 3 4.44772 3 5V13C3 13.5523 3.44772 14 4 14H10C10.5523 14 11 13.5523 11 13V12H12C12.5523 12 13 11.5523 13 11V5L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                    <path d="M5 4V3C5 2.44772 5.44772 2 6 2H9.5L13 5.5V11C13 11.5523 12.5523 12 12 12H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                </svg>
                            </button>
                            ` : '' }
                            ${ this.groupingEnabled ? `
                            <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.${ instanceName }.clearGrouping()" title="Очистить группировку">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle;">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>
                                    <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                            ` : '' }
                            <button class="btn btn-sm btn-outline-secondary me-2" onclick="window.${ instanceName }.openGroupingSettings()">
                                ${ this.groupingEnabled ? '✓' : '' } Группы
                            </button>
                            ${ this.hasActiveFilters() ? `
                            <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.${ instanceName }.clearAllFilters()" title="Очистить фильтры">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle;">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>
                                    <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                            ` : '' }
                            <button class="btn btn-sm btn-outline-secondary me-2" onclick="window.${ instanceName }.toggleFilters()">
                                ${ this.filtersEnabled ? '✓' : '' } Фильтры
                            </button>
                            <div class="integram-table-export-container">
                                <button class="btn btn-sm btn-outline-secondary me-2" onclick="window.${ instanceName }.toggleExportMenu(event)" title="Экспорт таблицы">
                                    📥 Экспорт
                                </button>
                                <div class="integram-export-menu" id="${ instanceName }-export-menu" style="display: none;">
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('xlsx')">
                                        <span class="export-icon">📊</span> XLSX (Excel)
                                    </div>
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('xls')">
                                        <span class="export-icon">📗</span> XLS (Excel 97-2003)
                                    </div>
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('csv')">
                                        <span class="export-icon">📄</span> CSV
                                    </div>
                                </div>
                            </div>
                            <div class="integram-table-checkbox-toggle${ this.checkboxMode ? ' active' : '' }" onclick="window.${ instanceName }.toggleCheckboxMode()" title="Выбор строк в таблице">
                                ☑
                            </div>
                            ${ this.checkboxMode && this.selectedRows.size > 0 ? `
                            <button class="btn btn-sm btn-danger integram-bulk-delete-btn" id="${ instanceName }-bulk-delete-btn" onclick="window.${ instanceName }.showBulkDeleteConfirm(event)">
                                Удалить (${ this.selectedRows.size })
                            </button>
                            ` : '' }
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openTableSettings()" title="Настройка">
                                ⚙️
                            </div>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openColumnSettings()">
                                <span font="size:+1" style="font-size: 146%;">▥</span> Колонки
                            </div>
                        </div>
                    </div>
                    ${ this.renderHiddenFilterBadges() }
                    <div class="integram-table-container">
                        <table class="integram-table${ this.settings.compact ? ' compact' : '' }">
                        <thead>
                            <tr>
                                ${ this.checkboxMode ? `<th class="checkbox-column-header"><input type="checkbox" class="row-select-all" title="Выбрать все" ${ this.data.length > 0 && this.selectedRows.size === this.data.length ? 'checked' : '' }></th>` : '' }
                                ${ this.groupingEnabled && this.groupingColumns.length > 0 ?
                                    this.renderGroupedHeaders(orderedColumns, instanceName) :
                                    orderedColumns.map(col => {
                                        const width = this.columnWidths[col.id];
                                        const widthStyle = width ? ` style="width: ${ width }px; min-width: ${ width }px;"` : '';
                                        const addButtonHtml = this.shouldShowAddButton(col) ?
                                            `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись">+</button>` : '';

                                        // Add sort indicator if this column is sorted
                                        let sortIndicator = '';
                                        if (this.sortColumn === col.id) {
                                            sortIndicator = this.sortDirection === 'asc' ? '▲ ' : '▼ ';
                                        }

                                        return `
                                        <th data-column-id="${ col.id }" draggable="true"${ widthStyle }>
                                            <span class="column-header-content" data-column-id="${ col.id }">${ sortIndicator }${ col.name }</span>
                                            ${ addButtonHtml }
                                            <div class="column-resize-handle" data-column-id="${ col.id }"></div>
                                        </th>
                                    `;
                                    }).join('')
                                }
                            </tr>
                            ${ this.filtersEnabled ? `
                            <tr class="filter-row">
                                ${ this.checkboxMode ? '<td class="checkbox-column-filter"></td>' : '' }
                                ${ this.groupingEnabled && this.groupingColumns.length > 0 ?
                                    this.renderGroupedFilterRow(orderedColumns) :
                                    orderedColumns.map((col, idx) => this.renderFilterCell(col, idx)).join('')
                                }
                            </tr>
                            ` : '' }
                        </thead>
                        <tbody>
                            ${ this.groupingEnabled && this.groupedData.length > 0 ?
                                this.renderGroupedRows(orderedColumns, instanceName) :
                                this.data.map((row, rowIndex) => `
                                    <tr class="${ this.selectedRows.has(rowIndex) ? 'row-selected' : '' }">
                                        ${ this.checkboxMode ? `<td class="checkbox-column-cell"><input type="checkbox" class="row-select-checkbox" data-row-index="${ rowIndex }" ${ this.selectedRows.has(rowIndex) ? 'checked' : '' }></td>` : '' }
                                        ${ orderedColumns.map((col, colIndex) => {
                                            const cellValue = row[this.columns.indexOf(col)];
                                            return this.renderCell(col, cellValue, rowIndex, colIndex);
                                        }).join('') }
                                    </tr>
                                `).join('')
                            }
                        </tbody>
                        </table>
                    </div>
                    ${ this.renderScrollCounter() }
                </div>
                <div class="integram-table-sticky-scrollbar" id="${ this.container.id }-sticky-scrollbar">
                    <div class="integram-table-sticky-scrollbar-content"></div>
                </div>
            `;

            this.container.innerHTML = html;
            this.attachEventListeners();
            this.attachScrollListener();
            this.attachStickyScrollbar();
            this.attachColumnResizeHandlers();

            // Restore focus state after re-rendering
            if (focusState) {
                const newInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${focusState.columnId}"]`);
                if (newInput) {
                    newInput.focus();
                    // Restore cursor position
                    if (focusState.selectionStart !== null && focusState.selectionEnd !== null) {
                        newInput.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
                    }
                }
            }
        }

        renderFilterCell(column, columnIndex = 0) {
            const format = column.format || 'SHORT';
            const currentFilter = this.filters[column.id] || { type: this.getDefaultFilterType(format), value: '' };
            const placeholder = columnIndex === 0 ? 'Фильтр...' : '';
            // Use displayValue (resolved text label) when available, otherwise use raw value (issue #551)
            const displayValue = currentFilter.displayValue !== undefined ? currentFilter.displayValue : currentFilter.value;

            return `
                <td>
                    <div class="filter-cell-wrapper">
                        <span class="filter-icon-inside" data-column-id="${ column.id }">
                            ${ currentFilter.type }
                        </span>
                        <input type="text"
                               class="filter-input-with-icon"
                               data-column-id="${ column.id }"
                               value="${ displayValue }"
                               placeholder="${ placeholder }">
                    </div>
                </td>
            `;
        }

        // Helper method to parse date format from API (supports both DD.MM.YYYY and YYYYMMDD)
        parseDDMMYYYY(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const trimmed = dateStr.trim();

            // Try YYYYMMDD format first (exactly 8 digits)
            if (/^\d{8}$/.test(trimmed)) {
                const year = parseInt(trimmed.substring(0, 4), 10);
                const month = parseInt(trimmed.substring(4, 6), 10);
                const day = parseInt(trimmed.substring(6, 8), 10);

                if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

                // Validate month and day ranges
                if (month < 1 || month > 12 || day < 1 || day > 31) return null;

                // Month is 0-indexed in JavaScript Date
                return new Date(year, month - 1, day);
            }

            // Try DD.MM.YYYY format
            const parts = trimmed.split('.');
            if (parts.length !== 3) return null;
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);
            if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Helper method to parse DD.MM.YYYY HH:MM:SS datetime format from API
        parseDDMMYYYYHHMMSS(datetimeStr) {
            if (!datetimeStr || typeof datetimeStr !== 'string') return null;
            const parts = datetimeStr.trim().split(' ');
            if (parts.length !== 2) return this.parseDDMMYYYY(datetimeStr); // Fallback to date-only

            const dateParts = parts[0].split('.');
            const timeParts = parts[1].split(':');

            if (dateParts.length !== 3 || timeParts.length !== 3) return null;

            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10);
            const year = parseInt(dateParts[2], 10);
            const hour = parseInt(timeParts[0], 10);
            const minute = parseInt(timeParts[1], 10);
            const second = parseInt(timeParts[2], 10);

            if (isNaN(day) || isNaN(month) || isNaN(year) ||
                isNaN(hour) || isNaN(minute) || isNaN(second)) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day, hour, minute, second);
        }

        // Helper method to parse YYYYMMDD date format from API
        parseYYYYMMDD(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const trimmed = dateStr.trim();

            // Check if it matches YYYYMMDD format (exactly 8 digits)
            if (!/^\d{8}$/.test(trimmed)) return null;

            const year = parseInt(trimmed.substring(0, 4), 10);
            const month = parseInt(trimmed.substring(4, 6), 10);
            const day = parseInt(trimmed.substring(6, 8), 10);

            if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

            // Validate month and day ranges
            if (month < 1 || month > 12 || day < 1 || day > 31) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Format Date object for display as DD.MM.YYYY
        formatDateDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            return `${ day }.${ month }.${ year }`;
        }

        // Format Date object for display as DD.MM.YYYY hh:mm:ss
        formatDateTimeDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const seconds = String(dateObj.getSeconds()).padStart(2, '0');
            return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
        }

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

            // In object format, reference fields return values as "id:Value"
            // Parse to extract the id and display only the Value part
            if (column.ref_id != null && value && typeof value === 'string') {
                const colonIndex = value.indexOf(':');
                if (colonIndex > 0) {
                    refValueId = value.substring(0, colonIndex);
                    displayValue = value.substring(colonIndex + 1);
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
                    displayValue = `<a href="#" class="subordinate-table-link" onclick="window.${ instanceName }.openSubordinateTableFromCell(event, ${ column.arr_id }, ${ recordId }); return false;" title="Открыть подчиненную таблицу"><span class="table-icon">📋</span><span class="subordinate-count">(${ count })</span></a>`;
                } else {
                    displayValue = `<span class="table-icon">📋</span><span class="subordinate-count">(${ count })</span>`;
                }
                return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }" data-arr-id="${ column.arr_id }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
            }

            switch (format) {
                case 'NUMBER':
                case 'SIGNED':
                    cellClass = 'number-cell';
                    break;
                case 'BOOLEAN':
                    cellClass = 'boolean-cell';
                    // Display as checkbox icon: any non-empty value = YES, empty = NO
                    // Don't return early - let code continue to editable logic
                    break;
                case 'DATE':
                    cellClass = 'date-cell';
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
                    cellClass = 'datetime-cell';
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
                    cellClass = 'memo-cell';
                    break;
                case 'PWD':
                    cellClass = 'pwd-cell';
                    // Only mask with asterisks if there's a value, show empty if empty
                    displayValue = (value !== null && value !== undefined && value !== '') ? '******' : '';
                    break;
                case 'FILE':
                    cellClass = 'file-cell';
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
                case 'BUTTON':
                    displayValue = `<button class="btn btn-sm btn-primary">${ value || 'Действие' }</button>`;
                    return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
            }

            let escapedValue;
            let fullValueForEditing;

            // BOOLEAN cells use HTML icons, so skip HTML escaping for them
            if (format === 'BOOLEAN') {
                const boolValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== false;
                escapedValue = boolValue ? '<span class="boolean-check">✓</span>' : '<span class="boolean-uncheck">✗</span>';
                // Store the original value for editing (1 or 0, or the actual value)
                fullValueForEditing = boolValue ? '1' : '0';
            } else {
                escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                          .replace(/</g, '&lt;')
                                                          .replace(/>/g, '&gt;')
                                                          .replace(/"/g, '&quot;')
                                                          .replace(/'/g, '&#039;');
                // Store full value for editing before truncation
                fullValueForEditing = escapedValue;
            }

            // Truncate long values if setting is enabled
            if (this.settings.truncateLongValues && escapedValue.length > 127) {
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

                if (shouldShowEditIcon) {
                    const editIcon = `<span class="edit-icon" onclick="window.${ instanceName }.openEditForm('${ recordId }', '${ typeId }', ${ rowIndex }); event.stopPropagation();" title="Редактировать"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M0 11.0833V14H2.91667L11.5442 5.3725L8.6275 2.45583L0 11.0833ZM13.8083 3.10833L10.8917 0.191667C10.6583 -0.0416667 10.2917 -0.0416667 10.0583 0.191667L7.90833 2.34167L10.825 5.25833L12.975 3.10833C13.2083 2.875 13.2083 2.50833 12.975 2.275L13.8083 3.10833Z" fill="currentColor"/></svg></span>`;
                    escapedValue = `<div class="cell-content-wrapper">${ escapedValue }${ editIcon }</div>`;
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
                    // Use 'dynamic' as placeholder for recordId if it's empty (will be determined at edit time)
                    const recordIdAttr = recordId && recordId !== '' && recordId !== '0' ? recordId : 'dynamic';
                    // Use paramId for object format (metadata ID), otherwise fall back to type (data type)
                    const colTypeForParam = column.paramId || column.type;
                    editableAttrs = ` data-editable="true" data-record-id="${ recordIdAttr }" data-col-id="${ column.id }" data-col-type="${ colTypeForParam }" data-col-format="${ format }" data-row-index="${ rowIndex }"${ refAttr }${ refValueIdAttr }${ fullValueAttr }`;
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
                            ? `<button class="group-cell-add-btn" onclick="window.${ instanceName }.openGroupedCellCreateForm(${ rowIndex }, ${ groupLevel })" title="Создать запись">+</button>`
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
                    `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись">+</button>` : '';

                // Add sort indicator if this column is sorted
                let sortIndicator = '';
                if (this.sortColumn === col.id) {
                    sortIndicator = this.sortDirection === 'asc' ? '▲ ' : '▼ ';
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
            const rowIndex = parseInt(cell.dataset.rowIndex);

            if (!colId || !colType) {
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
                parentInfo,
                originalValue: currentValue
            };

            // Create inline editor based on format or reference type
            if (isRef) {
                this.renderReferenceEditor(cell, currentValue);
            } else {
                this.renderInlineEditor(cell, currentValue, format);
            }
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
                    // First column has column.id === this.objectTableId
                    const isFirstColumn = colId === String(this.objectTableId);

                    if (window.INTEGRAM_DEBUG) {
                        console.log('[determineParentRecord] Object format detected:');
                        console.log('  - rowIndex:', rowIndex);
                        console.log('  - colId:', colId);
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
                                <button type="button" class="file-remove-btn" title="Удалить файл">×</button>
                            </div>
                        </div>
                    `;
                    break;
                default:
                    // SHORT, CHARS, etc. - text input
                    editorHtml = `<input type="text" class="inline-editor inline-editor-text" value="${ escapedValue }">`;
            }

            cell.innerHTML = editorHtml;
            const editor = cell.querySelector('.inline-editor');

            // Special handling for FILE type
            if (format === 'FILE') {
                this.attachFileUploadHandlers(editor, currentValue);
            }

            // Focus the editor
            if (format !== 'FILE') {
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
                } else {
                    newValue = editor.value;
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
                    } else if (e.key === 'ArrowUp') {
                        // Arrow Up: navigate to cell above (issue #518)
                        e.preventDefault();
                        this.saveAndNavigate('up', saveEdit, cancelEdit);
                    } else if (e.key === 'ArrowDown') {
                        // Arrow Down: navigate to cell below (issue #518)
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
                const outsideClickHandler = (e) => {
                    if (!cell.contains(e.target)) {
                        document.removeEventListener('click', outsideClickHandler);

                        // Check if click is on another editable cell - preserve focus (issue #518)
                        const clickedCell = e.target.closest('td[data-editable="true"]');
                        if (clickedCell && clickedCell !== cell) {
                            // Remember the clicked cell to edit after save completes
                            this.pendingCellClick = clickedCell;
                        }

                        saveEdit();
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
                let buttonHtml = `<button class="inline-editor-reference-clear" title="Очистить значение" aria-label="Очистить значение">×</button>`;
                if (showAddButton) {
                    buttonHtml += `<button class="inline-editor-reference-add" style="display: none;" title="Создать запись" aria-label="Создать запись">+</button>`;
                }

                // Create dropdown with search
                const editorHtml = `
                    <div class="inline-editor-reference">
                        <div class="inline-editor-reference-header">
                            <input type="text"
                                   class="inline-editor-reference-search"
                                   placeholder="Поиск..."
                                   autocomplete="off">
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

                const url = `${apiBase}/_m_set/${parentInfo.parentRecordId}?JSON`;


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

                // Update the cell display with the selected text
                this.updateCellDisplay(cell, selectedText, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving reference edit:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
                // Restore original content on error
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell && this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                this.currentEditingCell = null;

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

            let attributesHtml = `
                <div class="form-group">
                    <label for="field-main-ref-create">${typeName} <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            // Add all fields of this type
            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                attributesHtml += `<label for="field-ref-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

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
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
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
                    <h5>${title}</h5>
                    <button class="edit-form-close" data-close-modal-ref="true">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-ref-create" class="edit-form">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-record-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal-ref="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-ref-btn');
            saveBtn.addEventListener('click', async () => {
                await this.saveRecordForReference(modal, typeId, parentRecordId);
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
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=1`; // ${parentRecordId || 1}

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
                    await this.saveReferenceEdit(createdId, createdValue);
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

            const { cell, recordId, colId, colType, parentInfo } = this.currentEditingCell;

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
                    params.append(`t${ colType }`, newValue);
                } else {
                    // Use _m_set for requisites
                    url = `${ apiBase }/_m_set/${ parentRecordId }?JSON`;
                    params.append(`t${ colType }`, newValue);
                }

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

                // Update the cell display with the new value
                this.updateCellDisplay(cell, newValue, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving inline edit:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
                // Restore original content on error
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell && this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                this.currentEditingCell = null;

                // Navigate to pending cell if set (issue #518)
                if (this.pendingCellClick) {
                    const targetCell = this.pendingCellClick;
                    this.pendingCellClick = null;
                    this.navigateToCell(targetCell);
                }
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
                    escapedValue = boolValue ? '<span class="boolean-check">✓</span>' : '<span class="boolean-uncheck">✗</span>';
                    fullValueForEditing = boolValue ? '1' : '0';
                    break;
                case 'DATE':
                    if (newValue) {
                        const dateObj = this.parseDDMMYYYY(newValue);
                        if (dateObj && !isNaN(dateObj.getTime())) {
                            displayValue = this.formatDateDisplay(dateObj);
                        }
                    }
                    // Escape HTML and store for editing
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    fullValueForEditing = escapedValue;
                    break;
                case 'DATETIME':
                    if (newValue) {
                        const datetimeObj = this.parseDDMMYYYYHHMMSS(newValue);
                        if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                            displayValue = this.formatDateTimeDisplay(datetimeObj);
                        }
                    }
                    // Escape HTML and store for editing
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    fullValueForEditing = escapedValue;
                    break;
                default:
                    // Escape HTML and store for editing
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    fullValueForEditing = escapedValue;
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

            // Restore edit icon if present
            const hasEditIcon = cell.querySelector('.edit-icon');
            if (hasEditIcon) {
                const editIconHtml = hasEditIcon.outerHTML;
                cell.innerHTML = `<div class="cell-content-wrapper">${ escapedValue }${ editIconHtml }</div>`;
            } else {
                cell.innerHTML = escapedValue;
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

            const { cell } = this.currentEditingCell;

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

            this.currentEditingCell = null;

            // Navigate to pending cell if set (issue #518)
            if (this.pendingCellClick) {
                const targetCell = this.pendingCellClick;
                this.pendingCellClick = null;
                this.navigateToCell(targetCell);
            }
        }

        /**
         * Find all editable cells in the table (issue #518)
         * Returns array of TD elements with data-editable="true"
         */
        getEditableCells() {
            return Array.from(this.container.querySelectorAll('td[data-editable="true"]'));
        }

        /**
         * Find the next editable cell after the current one (issue #518)
         * Moves to the next cell in the same row, then wraps to the next row
         * @param {HTMLElement} currentCell - The currently focused cell
         * @returns {HTMLElement|null} - The next editable cell or null if none
         */
        findNextEditableCell(currentCell) {
            const editableCells = this.getEditableCells();
            if (editableCells.length === 0) return null;

            const currentIndex = editableCells.indexOf(currentCell);
            if (currentIndex === -1) return editableCells[0];

            // Get next cell (wrap to start if at end)
            const nextIndex = (currentIndex + 1) % editableCells.length;
            return editableCells[nextIndex];
        }

        /**
         * Find the previous editable cell before the current one (issue #518)
         * Moves to the previous cell in the same row, then wraps to the previous row
         * @param {HTMLElement} currentCell - The currently focused cell
         * @returns {HTMLElement|null} - The previous editable cell or null if none
         */
        findPreviousEditableCell(currentCell) {
            const editableCells = this.getEditableCells();
            if (editableCells.length === 0) return null;

            const currentIndex = editableCells.indexOf(currentCell);
            if (currentIndex === -1) return editableCells[editableCells.length - 1];

            // Get previous cell (wrap to end if at start)
            const prevIndex = (currentIndex - 1 + editableCells.length) % editableCells.length;
            return editableCells[prevIndex];
        }

        /**
         * Find the editable cell above the current one in the same column (issue #518)
         * @param {HTMLElement} currentCell - The currently focused cell
         * @returns {HTMLElement|null} - The cell above or null if none
         */
        findCellAbove(currentCell) {
            const currentRowIndex = parseInt(currentCell.dataset.rowIndex);
            const currentColId = currentCell.dataset.colId;

            if (isNaN(currentRowIndex) || currentRowIndex <= 0) return null;

            // Find the editable cell in the same column, one row above
            const targetRowIndex = currentRowIndex - 1;
            const cellAbove = this.container.querySelector(
                `td[data-editable="true"][data-row-index="${targetRowIndex}"][data-col-id="${currentColId}"]`
            );

            return cellAbove;
        }

        /**
         * Find the editable cell below the current one in the same column (issue #518)
         * @param {HTMLElement} currentCell - The currently focused cell
         * @returns {HTMLElement|null} - The cell below or null if none
         */
        findCellBelow(currentCell) {
            const currentRowIndex = parseInt(currentCell.dataset.rowIndex);
            const currentColId = currentCell.dataset.colId;

            if (isNaN(currentRowIndex)) return null;

            // Find the editable cell in the same column, one row below
            const targetRowIndex = currentRowIndex + 1;
            const cellBelow = this.container.querySelector(
                `td[data-editable="true"][data-row-index="${targetRowIndex}"][data-col-id="${currentColId}"]`
            );

            return cellBelow;
        }

        /**
         * Navigate to a different editable cell after saving/canceling (issue #518)
         * @param {HTMLElement} targetCell - The cell to navigate to
         */
        navigateToCell(targetCell) {
            if (!targetCell) return;

            // Small delay to ensure DOM is updated after save
            setTimeout(() => {
                this.startInlineEdit(targetCell);
            }, 50);
        }

        /**
         * Save the current edit and navigate to a target cell (issue #518)
         * @param {string} direction - 'next', 'prev', 'up', or 'down'
         * @param {Function} saveEdit - The save function to call
         * @param {Function} cancelEdit - The cancel function (for unchanged values)
         */
        async saveAndNavigate(direction, saveEdit, cancelEdit) {
            if (!this.currentEditingCell) return;

            const currentCell = this.currentEditingCell.cell;
            let targetCell = null;

            // Find target cell based on direction
            switch (direction) {
                case 'next':
                    targetCell = this.findNextEditableCell(currentCell);
                    break;
                case 'prev':
                    targetCell = this.findPreviousEditableCell(currentCell);
                    break;
                case 'up':
                    targetCell = this.findCellAbove(currentCell);
                    break;
                case 'down':
                    targetCell = this.findCellBelow(currentCell);
                    break;
            }

            // Store target for navigation after save completes
            this.pendingCellClick = targetCell;

            // Trigger save (which will check pendingCellClick and navigate)
            await saveEdit();
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
                // First check if container exists
                if (!this.container) return;
                const tableWrapper = this.container.querySelector('.integram-table-wrapper');
                if (!tableWrapper || this.isLoading || !this.hasMore) return;

                const rect = tableWrapper.getBoundingClientRect();
                // If table bottom is above viewport bottom (table fits on screen), load more
                if (rect.bottom < window.innerHeight - 50) {
                    this.loadData(true);  // Append mode
                }
            }, 100);  // Small delay to ensure DOM is updated
        }

        attachStickyScrollbar() {
            const tableContainer = this.container.querySelector('.integram-table-container');
            const stickyScrollbar = document.getElementById(`${this.container.id}-sticky-scrollbar`);
            const stickyContent = stickyScrollbar?.querySelector('.integram-table-sticky-scrollbar-content');

            if (!tableContainer || !stickyScrollbar || !stickyContent) return;

            // Set sticky scrollbar content width to match table width
            const updateStickyWidth = () => {
                const table = tableContainer.querySelector('.integram-table');
                if (table) {
                    stickyContent.style.width = table.scrollWidth + 'px';
                }
            };

            // Sync scroll positions
            const syncFromTable = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    stickyScrollbar.scrollLeft = tableContainer.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            const syncFromSticky = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    tableContainer.scrollLeft = stickyScrollbar.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            // Show/hide sticky scrollbar based on table container visibility
            const checkStickyVisibility = () => {
                const rect = tableContainer.getBoundingClientRect();
                const tableBottom = rect.bottom;
                const viewportHeight = window.innerHeight;

                // Show sticky scrollbar if table scrollbar is below viewport
                if (tableBottom > viewportHeight && tableContainer.scrollWidth > tableContainer.clientWidth) {
                    stickyScrollbar.style.display = 'block';
                } else {
                    stickyScrollbar.style.display = 'none';
                }
            };

            // Remove existing listeners if any
            if (this.tableScrollListener) {
                tableContainer.removeEventListener('scroll', this.tableScrollListener);
            }
            if (this.stickyScrollListener) {
                stickyScrollbar.removeEventListener('scroll', this.stickyScrollListener);
            }
            if (this.stickyVisibilityListener) {
                window.removeEventListener('scroll', this.stickyVisibilityListener);
                window.removeEventListener('resize', this.stickyVisibilityListener);
            }

            // Attach listeners
            this.tableScrollListener = syncFromTable;
            this.stickyScrollListener = syncFromSticky;
            this.stickyVisibilityListener = () => {
                checkStickyVisibility();
                updateStickyWidth();
            };

            tableContainer.addEventListener('scroll', this.tableScrollListener);
            stickyScrollbar.addEventListener('scroll', this.stickyScrollListener);
            window.addEventListener('scroll', this.stickyVisibilityListener);
            window.addEventListener('resize', this.stickyVisibilityListener);

            // Initial setup
            updateStickyWidth();
            checkStickyVisibility();
        }

        attachColumnResizeHandlers() {
            const resizeHandles = this.container.querySelectorAll('.column-resize-handle');

            resizeHandles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const columnId = handle.dataset.columnId;
                    const th = handle.parentElement;
                    const startX = e.pageX;
                    const startWidth = th.offsetWidth;

                    const onMouseMove = (e) => {
                        const diff = e.pageX - startX;
                        const newWidth = Math.max(50, startWidth + diff);  // Min width 50px

                        th.style.width = newWidth + 'px';
                        th.style.minWidth = newWidth + 'px';
                        this.columnWidths[columnId] = newWidth;
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        this.saveColumnState();
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });
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
                        this.filters[columnId] = { type: this.getDefaultFilterType(format), value: '' };
                    }
                    this.filters[columnId].type = symbol;
                    target.textContent = symbol;
                    menu.remove();

                    // Check if this filter overrides URL GET parameters (issue #500)
                    // This handles filter type changes, including Empty/Not Empty filters
                    this.handleFilterOverride(columnId, this.filters[columnId].value || symbol);

                    // For Empty (%) and Not Empty (!%) filters, clear input and apply immediately
                    if (symbol === '%' || symbol === '!%') {
                        this.filters[columnId].value = '';

                        // Clear the input field
                        const filterInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${columnId}"]`);
                        if (filterInput) {
                            filterInput.value = '';
                        }

                        // Reset data and load from beginning
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        this.loadData(false);
                    } else if (this.filters[columnId].value) {
                        // For other filter types, only reload if there's a value
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
                <div class="column-settings-list" id="column-settings-list-${instanceName}">
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
                <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 15px; gap: 10px;">
                    <button class="btn btn-primary" id="add-column-btn-${instanceName}">Добавить колонку</button>
                    <button class="btn btn-secondary" onclick="window.${ instanceName }.closeColumnSettings()">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Attach add column button handler
            const addColumnBtn = modal.querySelector(`#add-column-btn-${instanceName}`);
            if (addColumnBtn) {
                addColumnBtn.addEventListener('click', () => this.showAddColumnForm(modal));
            }

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

        /**
         * Show form to add a new column (issue #565, #567)
         * Displays a modal dialog with inputs for column name, base type, list value checkbox, and multiselect checkbox
         */
        showAddColumnForm(parentModal) {
            const instanceName = this.options.instanceName;

            // Base types available for selection
            const baseTypes = [
                { id: 3, name: 'Короткая строка (до 127 символов)' },
                { id: 8, name: 'Строка без ограничения длины' },
                { id: 9, name: 'Дата' },
                { id: 13, name: 'Целое число' },
                { id: 14, name: 'Число с десятичной частью' },
                { id: 11, name: 'Логическое значение (Да / Нет)' },
                { id: 12, name: 'Многострочный текст' },
                { id: 4, name: 'Дата и время' },
                { id: 10, name: 'Файл' }
            ];

            // Create modal overlay (issue #567: make the form a modal)
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'add-column-modal-overlay';
            modalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.32); z-index: 1001; backdrop-filter: blur(2px);';

            // Create modal container
            const modal = document.createElement('div');
            modal.className = 'add-column-modal';
            modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; padding: 20px; border-radius: 4px; box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22); z-index: 1002; max-width: 450px; width: 90%;';

            modal.innerHTML = `
                <h5 style="margin: 0 0 20px 0; font-weight: 500; font-size: 20px;">Добавить новую колонку</h5>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px;">Имя колонки:</label>
                    <input type="text" id="new-column-name-${instanceName}" class="form-control" placeholder="Введите имя колонки" style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px;">Базовый тип:</label>
                    <select id="new-column-type-${instanceName}" class="form-control" style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
                        ${baseTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                    </select>
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
                        <input type="checkbox" id="new-column-list-${instanceName}" style="margin-right: 10px; width: 18px; height: 18px;">
                        Списочное значение (справочник)
                    </label>
                </div>
                <div style="margin-bottom: 16px; display: none;" id="multiselect-container-${instanceName}">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
                        <input type="checkbox" id="new-column-multiselect-${instanceName}" style="margin-right: 10px; width: 18px; height: 18px;">
                        Разрешить мультивыбор (выбор нескольких значений)
                    </label>
                </div>
                <div id="add-column-error-${instanceName}" style="color: #dc3545; margin-bottom: 16px; display: none; font-size: 14px;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn btn-secondary" id="cancel-add-column-btn-${instanceName}">Отмена</button>
                    <button class="btn btn-success" id="create-column-btn-${instanceName}">Создать</button>
                </div>
            `;

            document.body.appendChild(modalOverlay);
            document.body.appendChild(modal);

            // Close modal function
            const closeAddColumnModal = () => {
                modalOverlay.remove();
                modal.remove();
            };

            // Close on overlay click
            modalOverlay.addEventListener('click', closeAddColumnModal);

            // Show/hide multiselect option based on list checkbox
            const listCheckbox = modal.querySelector(`#new-column-list-${instanceName}`);
            const multiselectContainer = modal.querySelector(`#multiselect-container-${instanceName}`);
            listCheckbox.addEventListener('change', () => {
                multiselectContainer.style.display = listCheckbox.checked ? 'block' : 'none';
                if (!listCheckbox.checked) {
                    modal.querySelector(`#new-column-multiselect-${instanceName}`).checked = false;
                }
            });

            // Cancel button handler
            modal.querySelector(`#cancel-add-column-btn-${instanceName}`).addEventListener('click', closeAddColumnModal);

            // Create button handler
            modal.querySelector(`#create-column-btn-${instanceName}`).addEventListener('click', async () => {
                const columnName = modal.querySelector(`#new-column-name-${instanceName}`).value.trim();
                const baseTypeId = parseInt(modal.querySelector(`#new-column-type-${instanceName}`).value);
                const isListValue = listCheckbox.checked;
                const isMultiselect = modal.querySelector(`#new-column-multiselect-${instanceName}`).checked;
                const errorDiv = modal.querySelector(`#add-column-error-${instanceName}`);

                // Validate
                if (!columnName) {
                    errorDiv.textContent = 'Введите имя колонки';
                    errorDiv.style.display = 'block';
                    return;
                }

                errorDiv.style.display = 'none';

                // Disable buttons during creation
                const createBtn = modal.querySelector(`#create-column-btn-${instanceName}`);
                const cancelBtn = modal.querySelector(`#cancel-add-column-btn-${instanceName}`);
                createBtn.disabled = true;
                cancelBtn.disabled = true;
                createBtn.textContent = 'Создание...';

                try {
                    const result = await this.createColumn(columnName, baseTypeId, isListValue, isMultiselect);

                    if (result.success) {
                        // Add new column to the column settings list in the parent modal
                        const columnList = parentModal.querySelector(`#column-settings-list-${instanceName}`);
                        if (columnList) {
                            const newItem = document.createElement('div');
                            newItem.className = 'column-settings-item';
                            newItem.innerHTML = `
                                <label>
                                    <input type="checkbox" data-column-id="${result.columnId}" checked>
                                    ${this.escapeHtml(columnName)}
                                </label>
                            `;
                            columnList.appendChild(newItem);

                            // Add event listener for the new checkbox
                            const newCheckbox = newItem.querySelector('input[type="checkbox"]');
                            newCheckbox.addEventListener('change', () => {
                                const colId = newCheckbox.dataset.columnId;
                                if (newCheckbox.checked) {
                                    if (!this.visibleColumns.includes(colId)) {
                                        this.visibleColumns.push(colId);
                                    }
                                } else {
                                    this.visibleColumns = this.visibleColumns.filter(id => id !== colId);
                                }
                                this.saveColumnState();
                                this.render();
                            });
                        }

                        // Add column to the table's internal state
                        this.columns.push({
                            id: String(result.columnId),
                            name: columnName,
                            type: baseTypeId,
                            paramId: result.termId
                        });

                        // Make the column visible
                        if (!this.visibleColumns.includes(String(result.columnId))) {
                            this.visibleColumns.push(String(result.columnId));
                        }

                        // Save state and re-render
                        this.saveColumnState();
                        this.render();

                        // Close the add column modal but keep the parent column settings modal open
                        closeAddColumnModal();
                    } else {
                        errorDiv.textContent = result.error || 'Ошибка при создании колонки';
                        errorDiv.style.display = 'block';
                        createBtn.disabled = false;
                        cancelBtn.disabled = false;
                        createBtn.textContent = 'Создать';
                    }
                } catch (error) {
                    console.error('Error creating column:', error);
                    errorDiv.textContent = error.message || 'Ошибка при создании колонки';
                    errorDiv.style.display = 'block';
                    createBtn.disabled = false;
                    cancelBtn.disabled = false;
                    createBtn.textContent = 'Создать';
                }
            });

            // Focus on the name input
            modal.querySelector(`#new-column-name-${instanceName}`).focus();

            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    closeAddColumnModal();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Create a new column via API (issue #565)
         * @param {string} columnName - Name of the new column
         * @param {number} baseTypeId - Base type ID (3, 4, 8, 9, 10, 11, 12, 13, 14)
         * @param {boolean} isListValue - Whether this is a list/lookup column
         * @param {boolean} isMultiselect - Whether multiple values can be selected (only for list columns)
         * @returns {Promise<{success: boolean, columnId?: string, termId?: string, error?: string}>}
         */
        async createColumn(columnName, baseTypeId, isListValue, isMultiselect) {
            const apiBase = this.getApiBase();
            const tableId = this.objectTableId || this.options.tableTypeId;

            if (!tableId) {
                return { success: false, error: 'Не удалось определить ID таблицы' };
            }

            try {
                // Step 1: Create term with the base type
                const termParams = new URLSearchParams();
                termParams.append('val', columnName);
                termParams.append('t', baseTypeId);
                if (typeof xsrf !== 'undefined') {
                    termParams.append('_xsrf', xsrf);
                }
                // For list values, add unique=1 flag
                if (isListValue) {
                    termParams.append('unique', '1');
                }

                const termResponse = await fetch(`${apiBase}/_d_new?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: termParams.toString()
                });

                if (!termResponse.ok) {
                    return { success: false, error: `Ошибка создания термина: ${termResponse.status}` };
                }

                const termResult = await termResponse.json();

                // Check for API error
                if (Array.isArray(termResult) && termResult[0]?.error) {
                    return { success: false, error: termResult[0].error };
                }

                const termId = termResult.obj;
                if (!termId) {
                    return { success: false, error: 'Не получен ID термина' };
                }

                let typeIdToAdd = termId;

                // Step 2: For list values, create a reference to the term
                if (isListValue) {
                    const refParams = new URLSearchParams();
                    if (typeof xsrf !== 'undefined') {
                        refParams.append('_xsrf', xsrf);
                    }

                    const refResponse = await fetch(`${apiBase}/_d_ref/${termId}?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: refParams.toString()
                    });

                    if (!refResponse.ok) {
                        return { success: false, error: `Ошибка создания ссылки: ${refResponse.status}` };
                    }

                    const refResult = await refResponse.json();

                    if (Array.isArray(refResult) && refResult[0]?.error) {
                        return { success: false, error: refResult[0].error };
                    }

                    typeIdToAdd = refResult.obj;
                    if (!typeIdToAdd) {
                        return { success: false, error: 'Не получен ID ссылки' };
                    }
                }

                // Step 3: Add the term/reference as a column (requisite) to the table
                const reqParams = new URLSearchParams();
                reqParams.append('t', typeIdToAdd);
                if (typeof xsrf !== 'undefined') {
                    reqParams.append('_xsrf', xsrf);
                }

                const reqResponse = await fetch(`${apiBase}/_d_req/${tableId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: reqParams.toString()
                });

                if (!reqResponse.ok) {
                    return { success: false, error: `Ошибка добавления колонки: ${reqResponse.status}` };
                }

                const reqResult = await reqResponse.json();

                if (Array.isArray(reqResult) && reqResult[0]?.error) {
                    return { success: false, error: reqResult[0].error };
                }

                const columnId = reqResult.id;
                if (!columnId) {
                    return { success: false, error: 'Не получен ID колонки' };
                }

                // Step 4: If multiselect is enabled for list values, toggle the multi flag
                if (isListValue && isMultiselect) {
                    const multiParams = new URLSearchParams();
                    if (typeof xsrf !== 'undefined') {
                        multiParams.append('_xsrf', xsrf);
                    }

                    await fetch(`${apiBase}/_d_multi/${columnId}?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: multiParams.toString()
                    });
                }

                return {
                    success: true,
                    columnId: String(columnId),
                    termId: String(termId)
                };
            } catch (error) {
                console.error('Error in createColumn:', error);
                return { success: false, error: error.message };
            }
        }

        openTableSettings() {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';
            const instanceName = this.options.instanceName;

            modal.innerHTML = `
                <h5>Настройка таблицы</h5>
                <div class="column-settings-list">
                    <div class="table-settings-item">
                        <button class="btn btn-sm btn-danger" id="reset-settings-btn">Сбросить настройки</button>
                    </div>

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
                        <input type="number" id="custom-page-size" class="form-control form-control-sm" style="display: none; width: 80px; margin-left: 10px;" placeholder="Число">
                    </div>

                    <div class="table-settings-item">
                        <label>Сокращать длинные значения:</label>
                        <div>
                            <label>
                                <input type="radio" name="truncate-mode" value="yes" ${ this.settings.truncateLongValues ? 'checked' : '' }>
                                Да
                            </label>
                            <label style="margin-left: 15px;">
                                <input type="radio" name="truncate-mode" value="no" ${ !this.settings.truncateLongValues ? 'checked' : '' }>
                                Нет
                            </label>
                        </div>
                    </div>
                </div>
                <div style="text-align: right; margin-top: 15px;">
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

            // Handle truncate mode change
            modal.querySelectorAll('input[name="truncate-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.settings.truncateLongValues = e.target.value === 'yes';
                    this.saveSettings();
                    this.render();
                });
            });

            overlay.addEventListener('click', () => this.closeTableSettings());
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
                pageSize: 20,
                truncateLongValues: true
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

        showFullValue(event, fullValue) {
            event.preventDefault();
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';

            modal.innerHTML = `
                <h5>Полное значение</h5>
                <div style="max-height: 400px; overflow-y: auto; margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0;">${ fullValue }</pre>
                </div>
                <div style="text-align: right;">
                    <button class="btn btn-secondary" onclick="this.closest('.column-settings-modal').remove(); document.querySelector('.column-settings-overlay').remove();">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            overlay.addEventListener('click', () => {
                modal.remove();
                overlay.remove();
            });
        }

        toggleFilters() {
            this.filtersEnabled = !this.filtersEnabled;
            this.render();
        }

        /**
         * Open grouping settings modal (issue #502)
         * Allows user to select columns to group by and their order
         */
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
                <h5>Настройка группировки</h5>
                <p style="color: var(--md-text-secondary); font-size: 14px; margin-bottom: 15px;">
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
        getConfigUrl() {
            const url = new URL(window.location.href);

            // Remove existing _itc parameter if present (table config)
            url.searchParams.delete('_itc');

            // Build configuration object
            const config = {};

            // Add filters
            if (this.hasActiveFilters()) {
                config.f = {};
                Object.keys(this.filters).forEach(colId => {
                    const filter = this.filters[colId];
                    if (filter && (filter.value || filter.type === '%' || filter.type === '!%')) {
                        config.f[colId] = {
                            t: filter.type,
                            v: filter.value || ''
                        };
                    }
                });
            }

            // Add grouping columns
            if (this.groupingEnabled && this.groupingColumns.length > 0) {
                config.g = this.groupingColumns;
            }

            // Add sorting
            if (this.sortColumn !== null && this.sortDirection !== null) {
                config.s = {
                    c: this.sortColumn,
                    d: this.sortDirection
                };
            }

            // Add column order (issue #514)
            if (this.columnOrder && this.columnOrder.length > 0) {
                config.o = this.columnOrder;
            }

            // Add visible columns (issue #514)
            if (this.visibleColumns && this.visibleColumns.length > 0) {
                config.v = this.visibleColumns;
            }

            // Encode configuration as base64 to keep URL clean
            // Using encodeURIComponent for URL safety
            const configJson = JSON.stringify(config);
            const configEncoded = btoa(encodeURIComponent(configJson));

            url.searchParams.set('_itc', configEncoded);

            return url.toString();
        }

        /**
         * Copy current table configuration URL to clipboard (issue #510)
         * Shows a notification when copied successfully
         */
        copyConfigUrl() {
            const url = this.getConfigUrl();

            // Try using modern Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    this.showCopyNotification('Ссылка скопирована в буфер обмена');
                }).catch(err => {
                    console.error('Failed to copy URL:', err);
                    this.fallbackCopyToClipboard(url);
                });
            } else {
                this.fallbackCopyToClipboard(url);
            }
        }

        /**
         * Fallback method to copy text to clipboard (issue #510)
         * Uses a temporary textarea element for older browsers
         * @param {string} text - Text to copy
         */
        fallbackCopyToClipboard(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            textArea.style.top = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    this.showCopyNotification('Ссылка скопирована в буфер обмена');
                } else {
                    this.showCopyNotification('Не удалось скопировать ссылку', true);
                }
            } catch (err) {
                console.error('Fallback copy failed:', err);
                this.showCopyNotification('Не удалось скопировать ссылку', true);
            }

            document.body.removeChild(textArea);
        }

        /**
         * Show a notification message (issue #510)
         * @param {string} message - Message to display
         * @param {boolean} isError - Whether this is an error message
         */
        showCopyNotification(message, isError = false) {
            // Remove any existing notifications
            document.querySelectorAll('.integram-copy-notification').forEach(n => n.remove());

            const notification = document.createElement('div');
            notification.className = 'integram-copy-notification' + (isError ? ' error' : '');
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 10px 20px;
                background-color: ${isError ? '#dc3545' : '#28a745'};
                color: white;
                border-radius: 4px;
                font-size: 14px;
                z-index: 10000;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                animation: fadeInOut 2s ease-in-out;
            `;

            // Add animation keyframes if not already present
            if (!document.getElementById('integram-copy-notification-styles')) {
                const style = document.createElement('style');
                style.id = 'integram-copy-notification-styles';
                style.textContent = `
                    @keyframes fadeInOut {
                        0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                        15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                        85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                        100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(notification);

            // Remove notification after animation completes
            setTimeout(() => {
                notification.remove();
            }, 2000);
        }

        /**
         * Load table configuration from URL parameters (issue #510)
         * Called during initialization to restore saved filters and groups
         */
        loadConfigFromUrl() {
            const urlParams = new URLSearchParams(window.location.search);
            const configEncoded = urlParams.get('_itc');

            if (!configEncoded) {
                return;
            }

            try {
                // Decode configuration
                const configJson = decodeURIComponent(atob(configEncoded));
                const config = JSON.parse(configJson);

                // Restore filters
                if (config.f && typeof config.f === 'object') {
                    this.filters = {};
                    Object.keys(config.f).forEach(colId => {
                        const filterConfig = config.f[colId];
                        if (filterConfig) {
                            this.filters[colId] = {
                                type: filterConfig.t || '^',
                                value: filterConfig.v || ''
                            };
                        }
                    });
                    // Enable filters panel if there are any filters
                    if (Object.keys(this.filters).length > 0) {
                        this.filtersEnabled = true;
                    }
                }

                // Restore grouping
                if (config.g && Array.isArray(config.g) && config.g.length > 0) {
                    this.groupingEnabled = true;
                    this.groupingColumns = config.g;
                }

                // Restore sorting
                if (config.s && config.s.c) {
                    this.sortColumn = config.s.c;
                    this.sortDirection = config.s.d || 'asc';
                }

                // Restore column order (issue #514)
                if (config.o && Array.isArray(config.o) && config.o.length > 0) {
                    this.columnOrder = config.o;
                    this.configFromUrl = true;  // Mark that config came from URL
                }

                // Restore visible columns (issue #514)
                if (config.v && Array.isArray(config.v) && config.v.length > 0) {
                    this.visibleColumns = config.v;
                    this.configFromUrl = true;  // Mark that config came from URL
                }
            } catch (e) {
                console.error('Error loading table configuration from URL:', e);
            }
        }

        /**
         * Parse URL GET parameters for filter values (FR_*, TO_*, F_*) - issue #547, issue #549
         * Called after columns are loaded to populate filters from URL params.
         * Detects filter type based on the parameter value format.
         * Supports three prefix formats:
         *   - FR_ : standard filter prefix
         *   - TO_ : range filter second part (used with FR_)
         *   - F_  : alternative filter prefix (same behavior as FR_)
         */
        parseUrlFiltersFromParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const urlFilters = {};

            // Parameters to exclude (handled elsewhere)
            // F_I added for issue #563
            const excludeParams = new Set(['parentId', 'F_U', 'F_I', 'up', 'LIMIT', 'ORDER', 'RECORD_COUNT', '_count', 'JSON_OBJ', 'JSON', '_itc']);

            for (const [key, value] of urlParams.entries()) {
                if (excludeParams.has(key)) continue;

                // Check for FR_ prefix
                if (key.startsWith('FR_')) {
                    const colId = key.substring(3);  // Remove 'FR_' prefix
                    const parsed = this.parseFilterValue(value);
                    urlFilters[colId] = {
                        type: parsed.type,
                        value: parsed.value,
                        paramKey: key
                    };
                    // Store ref ID info for @id-based filters (issue #551)
                    if (parsed.isRefId) {
                        urlFilters[colId].isRefId = true;
                        urlFilters[colId].refId = parsed.refId;
                    }
                }
                // Check for F_ prefix (alternative filter format) - issue #549
                // Note: F_U is excluded above as it's used for parentId
                else if (key.startsWith('F_')) {
                    const colId = key.substring(2);  // Remove 'F_' prefix
                    const parsed = this.parseFilterValue(value);
                    urlFilters[colId] = {
                        type: parsed.type,
                        value: parsed.value,
                        paramKey: key
                    };
                    // Store ref ID info for @id-based filters (issue #551)
                    if (parsed.isRefId) {
                        urlFilters[colId].isRefId = true;
                        urlFilters[colId].refId = parsed.refId;
                    }
                }
                // Check for TO_ prefix (range filter second part)
                else if (key.startsWith('TO_')) {
                    const colId = key.substring(3);  // Remove 'TO_' prefix
                    // If we already have a FR_ or F_ for this column, combine into range
                    if (urlFilters[colId]) {
                        urlFilters[colId].type = '...';
                        urlFilters[colId].value = `${urlFilters[colId].value},${value}`;
                        urlFilters[colId].toParamKey = key;
                    }
                }
            }

            this.urlFilters = urlFilters;

            // If we have URL filters, populate this.filters and enable filter row
            if (Object.keys(urlFilters).length > 0) {
                Object.keys(urlFilters).forEach(colId => {
                    const urlFilter = urlFilters[colId];
                    this.filters[colId] = {
                        type: urlFilter.type,
                        value: urlFilter.value
                    };
                });
                this.filtersEnabled = true;

                // Resolve @id-based filters to display labels (issue #551)
                // This is done asynchronously after setting up filters
                this.resolveRefIdUrlFilters();
            }
        }

        /**
         * Resolve @id-based URL filter values to human-readable text labels (issue #551).
         * For each URL filter with @{id} format (e.g. FR_4547=@6753), calls _ref_reqs/{colId}
         * to get the list of options, then finds the matching option by ID and stores the
         * text label as displayValue on the filter. The displayValue is shown in the filter
         * input instead of the raw @id value.
         *
         * If the user modifies or resets the filter, the displayValue is cleared
         * and the user's actual input is used instead.
         */
        resolveRefIdUrlFilters() {
            const refIdFilters = Object.entries(this.urlFilters).filter(([, f]) => f.isRefId);
            if (refIdFilters.length === 0) return;

            refIdFilters.forEach(async ([colId, urlFilter]) => {
                try {
                    const options = await this.fetchReferenceOptions(colId);
                    // Find the option whose ID matches the refId from the URL filter
                    const match = options.find(([id]) => String(id) === String(urlFilter.refId));
                    if (match) {
                        const [, label] = match;
                        // Only update displayValue if the filter has not been overridden by the user
                        if (this.filters[colId] && this.filters[colId].value === urlFilter.value) {
                            this.filters[colId].displayValue = label;
                            // Update the filter input in the DOM if it is already rendered
                            const input = this.container
                                ? this.container.querySelector(`.filter-input-with-icon[data-column-id="${colId}"]`)
                                : null;
                            if (input && input.value === urlFilter.value) {
                                input.value = label;
                            }
                        }
                    }
                } catch (e) {
                    // Non-fatal: if we cannot resolve the label, keep the raw @id value
                    if (window.INTEGRAM_DEBUG) {
                        console.warn(`[resolveRefIdUrlFilters] Could not resolve ref options for column ${colId}:`, e);
                    }
                }
            });
        }

        /**
         * Parse a filter value from URL to determine filter type and actual value.
         * Based on format patterns from this.filterTypes.
         * @param {string} rawValue - The raw value from URL parameter
         * @returns {{ type: string, value: string }} Filter type symbol and extracted value
         */
        parseFilterValue(rawValue) {
            if (!rawValue || rawValue === '') {
                return { type: '^', value: '' };
            }

            // Check for empty/not empty filters
            if (rawValue === '%') {
                return { type: '%', value: '' };
            }
            if (rawValue === '!%') {
                return { type: '!%', value: '' };
            }

            // Check for ID-based filter: @{id} means filter by record ID, not by text value (issue #551)
            // Example: FR_4547=@6753 means filter column 4547 by record ID 6753
            const refIdMatch = rawValue.match(/^@(\d+)$/);
            if (refIdMatch) {
                return { type: '=', value: rawValue, isRefId: true, refId: refIdMatch[1] };
            }

            // Check for IN() list filter: IN(val1,val2,...)
            const inMatch = rawValue.match(/^IN\((.+)\)$/);
            if (inMatch) {
                return { type: '(,)', value: inMatch[1] };
            }

            // Check for "not equals" filter: !value
            if (rawValue.startsWith('!')) {
                const innerValue = rawValue.substring(1);
                // Check if it's "not contains": !%value%
                if (innerValue.startsWith('%') && innerValue.endsWith('%')) {
                    return { type: '!', value: innerValue.slice(1, -1) };
                }
                // Check if it's "not starts with": !%value (ends with %, starts with !%)
                if (innerValue.startsWith('%') && !innerValue.endsWith('%')) {
                    return { type: '!^', value: innerValue.substring(1) };
                }
                // Simple "not equals": !value
                return { type: '≠', value: innerValue };
            }

            // Check for comparison operators: >=, <=, >, <
            if (rawValue.startsWith('>=')) {
                return { type: '≥', value: rawValue.substring(2) };
            }
            if (rawValue.startsWith('<=')) {
                return { type: '≤', value: rawValue.substring(2) };
            }
            // Note: > and < are less common as URL values may use different encoding
            // The format uses FR_{T}>{X} but the value itself doesn't include >
            // After parsing in applyFilter, it becomes just the value

            // Check for "contains" filter: %value%
            if (rawValue.startsWith('%') && rawValue.endsWith('%') && rawValue.length > 2) {
                return { type: '~', value: rawValue.slice(1, -1) };
            }

            // Check for "ends with" filter: %value (starts with %, doesn't end with %)
            if (rawValue.startsWith('%') && !rawValue.endsWith('%')) {
                return { type: '$', value: rawValue.substring(1) };
            }

            // Check for "starts with" filter: value%
            if (rawValue.endsWith('%') && !rawValue.startsWith('%')) {
                return { type: '^', value: rawValue.slice(0, -1) };
            }

            // Default: equals
            return { type: '=', value: rawValue };
        }

        /**
         * Check if there are any URL filter parameters that apply to hidden columns.
         * @returns {Array} Array of { colId, colName, filter } for hidden column filters
         */
        getHiddenColumnFilters() {
            const hiddenFilters = [];

            Object.keys(this.urlFilters).forEach(colId => {
                const urlFilter = this.urlFilters[colId];
                const column = this.columns.find(c => c.id === colId);

                // Check if column is hidden (not in visibleColumns) or doesn't exist
                const isHidden = !column || !this.visibleColumns.includes(colId);

                if (isHidden) {
                    const colName = column ? column.name : colId;
                    hiddenFilters.push({
                        colId: colId,
                        colName: colName,
                        filter: urlFilter
                    });
                }
            });

            return hiddenFilters;
        }

        /**
         * Check if there are any URL filter parameters present.
         * @returns {boolean} True if there are URL filters
         */
        hasUrlFilters() {
            return Object.keys(this.urlFilters).length > 0;
        }

        /**
         * Remove a specific URL filter and update browser URL.
         * @param {string} colId - Column ID to remove filter for
         */
        removeUrlFilter(colId) {
            const urlFilter = this.urlFilters[colId];
            if (!urlFilter) return;

            // Remove from urlFilters
            delete this.urlFilters[colId];

            // Remove from filters
            delete this.filters[colId];

            // Mark as overridden so it won't be forwarded to API
            if (urlFilter.paramKey) {
                this.overriddenUrlParams.add(urlFilter.paramKey);
            }
            if (urlFilter.toParamKey) {
                this.overriddenUrlParams.add(urlFilter.toParamKey);
            }

            // Update browser URL
            const newUrlParams = new URLSearchParams(window.location.search);
            if (urlFilter.paramKey) {
                newUrlParams.delete(urlFilter.paramKey);
            }
            if (urlFilter.toParamKey) {
                newUrlParams.delete(urlFilter.toParamKey);
            }

            const newUrl = window.location.pathname + (newUrlParams.toString() ? '?' + newUrlParams.toString() : '');
            window.history.replaceState({}, '', newUrl);

            // Reload data with updated filters
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Clear all URL filters and remove them from URL.
         */
        clearAllUrlFilters() {
            // Collect all URL filter param keys
            const paramsToRemove = [];
            Object.values(this.urlFilters).forEach(urlFilter => {
                if (urlFilter.paramKey) paramsToRemove.push(urlFilter.paramKey);
                if (urlFilter.toParamKey) paramsToRemove.push(urlFilter.toParamKey);
            });

            // Mark all as overridden
            paramsToRemove.forEach(key => this.overriddenUrlParams.add(key));

            // Clear urlFilters
            this.urlFilters = {};

            // Clear corresponding filters
            this.filters = {};

            // Update browser URL
            const newUrlParams = new URLSearchParams(window.location.search);
            paramsToRemove.forEach(key => newUrlParams.delete(key));

            const newUrl = window.location.pathname + (newUrlParams.toString() ? '?' + newUrlParams.toString() : '');
            window.history.replaceState({}, '', newUrl);

            // Reload data
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Render badges for filters on hidden columns (issue #547).
         * These appear above the table to show filters for columns not currently visible.
         * @returns {string} HTML for hidden filter badges
         */
        renderHiddenFilterBadges() {
            const hiddenFilters = this.getHiddenColumnFilters();
            if (hiddenFilters.length === 0) return '';

            const instanceName = this.options.instanceName;
            const badges = hiddenFilters.map(hf => {
                const filterTypeSymbol = hf.filter.type || '^';
                // Use resolved text label for @id-based filters when available (issue #551)
                const activeFilter = this.filters[hf.colId];
                const resolvedLabel = activeFilter && activeFilter.displayValue !== undefined
                    ? activeFilter.displayValue
                    : (hf.filter.value || '');
                const displayValue = resolvedLabel ? `${filterTypeSymbol} ${resolvedLabel}` : filterTypeSymbol;

                return `
                    <span class="hidden-filter-badge" data-col-id="${hf.colId}">
                        <span class="hidden-filter-badge-name">${hf.colName}</span>
                        <span class="hidden-filter-badge-value">${displayValue}</span>
                        <span class="hidden-filter-badge-remove" onclick="window.${instanceName}.removeUrlFilter('${hf.colId}')" title="Удалить фильтр">×</span>
                    </span>
                `;
            }).join('');

            return `
                <div class="hidden-filter-badges-container">
                    ${badges}
                </div>
            `;
        }

        clearAllFilters() {
            // Clear all filters
            this.filters = {};

            // Also clear URL filters and remove from browser URL (issue #547)
            if (this.hasUrlFilters()) {
                const paramsToRemove = [];
                Object.values(this.urlFilters).forEach(urlFilter => {
                    if (urlFilter.paramKey) paramsToRemove.push(urlFilter.paramKey);
                    if (urlFilter.toParamKey) paramsToRemove.push(urlFilter.toParamKey);
                });

                // Mark as overridden
                paramsToRemove.forEach(key => this.overriddenUrlParams.add(key));

                // Update browser URL
                const newUrlParams = new URLSearchParams(window.location.search);
                paramsToRemove.forEach(key => newUrlParams.delete(key));

                const newUrl = window.location.pathname + (newUrlParams.toString() ? '?' + newUrlParams.toString() : '');
                window.history.replaceState({}, '', newUrl);

                // Clear urlFilters
                this.urlFilters = {};
            }

            // Reset data and load from beginning
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);

            // Re-render to update UI (clear filter inputs)
            this.render();
        }

        /**
         * Toggle sort for a column
         * Cycle: no sort → ascending → descending → no sort
         * Clicking on a different column resets the previous sort and starts ascending on new column
         */
        toggleSort(columnId) {
            if (this.sortColumn === columnId) {
                // Same column - cycle through states
                if (this.sortDirection === 'asc') {
                    // asc → desc
                    this.sortDirection = 'desc';
                } else if (this.sortDirection === 'desc') {
                    // desc → no sort
                    this.sortColumn = null;
                    this.sortDirection = null;
                } else {
                    // Should not happen, but just in case
                    this.sortDirection = 'asc';
                }
            } else {
                // Different column - start with ascending
                this.sortColumn = columnId;
                this.sortDirection = 'asc';
            }

            // Reset data and load from beginning with new sort
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Reload table data with current filter parameters
         * This method resets the table state and reloads from the beginning
         * while preserving current filters, column settings, and other state
         */
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
                pageSize: this.settings.pageSize,
                truncateLongValues: this.settings.truncateLongValues
            };
            document.cookie = `${ this.options.cookiePrefix }-settings=${ JSON.stringify(settings) }; path=/; max-age=31536000`;
        }

        loadSettings() {
            const cookies = document.cookie.split(';');
            const settingsCookie = cookies.find(c => c.trim().startsWith(`${ this.options.cookiePrefix }-settings=`));

            if (settingsCookie) {
                try {
                    const settings = JSON.parse(settingsCookie.split('=')[1]);
                    this.settings.compact = settings.compact !== undefined ? settings.compact : false;
                    this.settings.pageSize = settings.pageSize || 20;
                    this.settings.truncateLongValues = settings.truncateLongValues !== undefined ? settings.truncateLongValues : true;

                    // Update options.pageSize to match loaded settings
                    this.options.pageSize = this.settings.pageSize;
                } catch (e) {
                    console.error('Error loading settings:', e);
                }
            }
        }

        // Modal Edit Form functionality
        async openEditForm(recordId, typeId, rowIndex) {
            if (!typeId) {
                this.showToast('Ошибка: не указан тип записи', 'error');
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
                    recordData = await this.fetchRecordData(recordId);
                }

                this.renderEditFormModal(metadata, recordData, isCreate, typeId);
            } catch (error) {
                console.error('Error opening edit form:', error);
                this.showToast(`Ошибка загрузки формы: ${ error.message }`, 'error');
            }
        }

        shouldShowAddButton(column) {
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
                const createRecordData = prefillReqs ? { obj: { val: '', parent: 1 }, reqs: prefillReqs } : null;

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
            // Check if this is object/table format
            const isObjectFormat = (this.rawObjectData && this.rawObjectData.length > 0 && this.objectTableId)
                || this.options.dataSource === 'table';

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

                    // For reference fields, extract the ID part from "id:Value" format
                    const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
                    let valueToUse = rawValue;

                    if (isRefField && typeof rawValue === 'string') {
                        const colonIndex = rawValue.indexOf(':');
                        if (colonIndex > 0) {
                            // Use only the ID part for prefilling reference fields
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
            const apiBase = this.getApiBase();
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
                if (data.error) {
                    throw new Error(data.error);
                }

                return data;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        async fetchRecordData(recordId) {
            const apiBase = this.getApiBase();
            const response = await fetch(`${ apiBase }/edit_obj/${ recordId }?JSON`);

            if (!response.ok) {
                throw new Error(`Failed to fetch record data: ${ response.statusText }`);
            }

            const text = await response.text();

            try {
                const data = JSON.parse(text);

                // Check for error in response
                if (data.error) {
                    throw new Error(data.error);
                }

                return data;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        async fetchReferenceOptions(requisiteId, recordId = 0, searchQuery = '', extraParams = {}) {
            const apiBase = this.getApiBase();

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

            if (recordId && recordId !== 0) {
                params.append('id', recordId);
            }
            if (searchQuery) {
                params.append('q', searchQuery);
            }
            for (const [key, value] of Object.entries(extraParams)) {
                params.set(key, value);
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
                if (data.error) {
                    throw new Error(data.error);
                }

                // Parse JSON text to extract key-value pairs in original server order
                // (JavaScript objects with numeric string keys iterate in numeric order, not insertion order)
                return this.parseJsonObjectAsArray(text);
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        /**
         * Parse JSON object text into an array of [key, value] tuples preserving original order.
         * This is necessary because JavaScript objects reorder numeric string keys.
         * @param {string} jsonText - JSON text representing an object
         * @returns {Array<[string, string]>} Array of [id, text] tuples in original order
         */
        parseJsonObjectAsArray(jsonText) {
            const result = [];
            // Match "key": "value" or "key": value patterns, preserving order
            const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|([^,}\s]+))/g;
            let match;
            while ((match = regex.exec(jsonText)) !== null) {
                const key = match[1].replace(/\\(.)/g, '$1'); // Unescape
                const value = match[2] !== undefined
                    ? match[2].replace(/\\(.)/g, '$1')  // String value, unescape
                    : match[3];  // Non-string value (number, boolean, null)
                result.push([key, value]);
            }
            return result;
        }

        getMetadataName(metadata) {
            return metadata.val || metadata.name || metadata.title || `Тип #${ metadata.id || '?' }`;
        }

        getApiBase() {
            // Extract base URL from apiUrl by removing query parameters and path after /report/, /type/, /metadata/, or /object/
            const url = this.options.apiUrl;
            if (!url) {
                // Fallback: construct API base from current page URL using the database path segment
                const pathParts = window.location.pathname.split('/');
                if (pathParts.length >= 2 && pathParts[1]) {
                    return 'https://' + window.location.hostname + '/' + pathParts[1];
                }
                return '';
            }
            const match = url.match(/^(.*?\/(report|type|metadata|object)\/\d+)/);
            if (match) {
                return match[1].replace(/\/(report|type|metadata|object)\/\d+$/, '');
            }
            // Fallback: remove everything after ? or last /
            return url.split('?')[0].replace(/\/[^\/]*$/, '');
        }

        /**
         * Determine the data source type based on the API URL
         * @returns {string} 'report' if URL contains /report/, 'table' if URL contains /metadata/
         */
        getDataSourceType() {
            const url = this.options.apiUrl;
            if (url && /\/report\//.test(url)) {
                return 'report';
            }
            if (url && /\/metadata\//.test(url)) {
                return 'table';
            }
            // Fallback to configured dataSource option
            return this.options.dataSource;
        }

        /**
         * Get GET parameters from the current page URL to forward to API requests.
         * Excludes parameters that are already handled internally (parentId, F_U, up).
         * Also excludes parameters that have been overridden by user filters (issue #500).
         * @returns {URLSearchParams} Parameters to append to API requests
         */
        getPageUrlParams() {
            const pageParams = new URLSearchParams(window.location.search);
            const forwardParams = new URLSearchParams();

            // Parameters to exclude (already handled internally or could conflict)
            // F_I added for issue #563
            const excludeParams = new Set(['parentId', 'F_U', 'F_I', 'up', 'LIMIT', 'ORDER', 'RECORD_COUNT', '_count', 'JSON_OBJ', 'JSON']);

            for (const [key, value] of pageParams.entries()) {
                // Skip excluded params
                if (excludeParams.has(key)) continue;

                // Skip params that have been overridden by user filters (issue #500)
                if (this.overriddenUrlParams.has(key)) continue;

                forwardParams.append(key, value);
            }

            return forwardParams;
        }

        /**
         * Check if a column's filter corresponds to URL GET parameters and handle override.
         * When user sets a filter for a field that came from URL parameters:
         * 1. Mark those parameters as overridden (won't be forwarded to API)
         * 2. Remove them from the browser URL using history.replaceState
         * @param {string} colId - The column ID being filtered
         * @param {string} filterValue - The new filter value
         */
        handleFilterOverride(colId, filterValue) {
            // URL parameter patterns for this column: FR_{colId}, TO_{colId}, F_{colId} (issue #549)
            const urlParams = new URLSearchParams(window.location.search);
            const paramsToRemove = [];

            // Check for FR_, TO_, and F_ parameters for this column
            for (const [key, value] of urlParams.entries()) {
                if (key === `FR_${colId}` || key === `TO_${colId}` || key === `F_${colId}`) {
                    paramsToRemove.push(key);
                }
            }

            // If there are URL parameters for this column and user is setting a filter
            if (paramsToRemove.length > 0 && (filterValue || filterValue === '')) {
                // Mark these parameters as overridden
                paramsToRemove.forEach(key => {
                    this.overriddenUrlParams.add(key);
                });

                // Remove these parameters from the browser URL
                const newUrlParams = new URLSearchParams(window.location.search);
                paramsToRemove.forEach(key => {
                    newUrlParams.delete(key);
                });

                // Update browser URL without reloading the page
                const newUrl = window.location.pathname + (newUrlParams.toString() ? '?' + newUrlParams.toString() : '');
                window.history.replaceState({}, '', newUrl);
            }
        }

        /**
         * Append page URL parameters to an existing URLSearchParams object.
         * @param {URLSearchParams} params - The params object to append to
         */
        appendPageUrlParams(params) {
            const pageParams = this.getPageUrlParams();
            for (const [key, value] of pageParams.entries()) {
                // Only append if not already set (avoid duplicates)
                if (!params.has(key)) {
                    params.append(key, value);
                }
            }
        }

        parseAttrs(attrs) {
            const result = {
                required: false,
                multi: false,
                alias: null
            };

            if (!attrs) return result;

            result.required = attrs.includes(':!NULL:');
            result.multi = attrs.includes(':MULTI:');

            const aliasMatch = attrs.match(/:ALIAS=(.*?):/);
            if (aliasMatch) {
                result.alias = aliasMatch[1];
            }

            return result;
        }

        getFormatById(typeId) {
            // Map type IDs to format names based on TABLE_COMPONENT_README.md
            const formatMap = {
                '3': 'SHORT',
                '8': 'CHARS',
                '9': 'DATE',
                '13': 'NUMBER',
                '14': 'SIGNED',
                '11': 'BOOLEAN',
                '12': 'MEMO',
                '4': 'DATETIME',
                '10': 'FILE',
                '2': 'HTML',
                '7': 'BUTTON',
                '6': 'PWD',
                '5': 'GRANT',
                '16': 'REPORT_COLUMN',
                '17': 'PATH'
            };
            return formatMap[String(typeId)] || 'SHORT';
        }

        normalizeFormat(baseTypeId) {
            // If baseTypeId is already a symbolic format name (like "MEMO", "BOOLEAN"),
            // use it directly without conversion
            const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                                  'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                                  'GRANT', 'REPORT_COLUMN', 'PATH'];

            const upperTypeId = String(baseTypeId).toUpperCase();

            if (validFormats.includes(upperTypeId)) {
                // Already a symbolic format name - return as is
                return upperTypeId;
            }

            // Otherwise, it's a numeric ID - convert it
            return this.getFormatById(baseTypeId);
        }

        renderEditFormModal(metadata, recordData, isCreate, typeId, columnId = null) {
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

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            // Store reference to overlay on modal for proper cleanup
            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const firstColumnValue = !isCreate && recordData && recordData.obj ? recordData.obj.val : null;
            const title = isCreate ? `Создание: ${ typeName }` : `Редактирование: ${ firstColumnValue || typeName }`;
            const instanceName = this.options.instanceName;
            const recordId = recordData && recordData.obj ? recordData.obj.id : null;
            const parentId = recordData && recordData.obj ? recordData.obj.parent : 1;

            // Build record ID and table link HTML for edit mode (issue #563)
            let recordIdHtml = '';
            if (!isCreate && recordId) {
                // Extract database name from URL path
                const pathParts = window.location.pathname.split('/');
                const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                // Build table URL with filters: /{dbName}/table/{typeId}?F_U={parentId}&F_I={recordId}
                const tableUrl = `/${dbName}/table/${typeId}?F_U=${parentId || 1}&F_I=${recordId}`;

                recordIdHtml = `
                    <span class="edit-form-record-id" onclick="window.${instanceName}.copyRecordIdToClipboard('${recordId}')" title="Скопировать ID">#${recordId}</span>
                    <a href="${tableUrl}" class="edit-form-table-link" title="Открыть в таблице" target="_blank">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
                            <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" stroke-width="1.5"/>
                            <line x1="6" y1="6" x2="6" y2="14" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </a>
                `;
            }

            // Separate regular fields from subordinate tables
            const reqs = metadata.reqs || [];
            const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};

            // Sort by order if available
            const sortedReqs = reqs.sort((a, b) => {
                const orderA = recordReqs[a.id] ? recordReqs[a.id].order || 0 : 0;
                const orderB = recordReqs[b.id] ? recordReqs[b.id].order || 0 : 0;
                return orderA - orderB;
            });

            const regularFields = sortedReqs.filter(req => !req.arr_id);
            const subordinateTables = sortedReqs.filter(req => req.arr_id);

            // Build tabs HTML
            let tabsHtml = '';
            let hasSubordinateTables = subordinateTables.length > 0 && !isCreate && recordId;

            if (hasSubordinateTables) {
                tabsHtml = `<div class="edit-form-tabs">`;
                tabsHtml += `<div class="edit-form-tab active" data-tab="attributes">Атрибуты</div>`;

                subordinateTables.forEach(req => {
                    const attrs = this.parseAttrs(req.attrs);
                    const fieldName = attrs.alias || req.val;
                    const arrCount = recordReqs[req.id] ? recordReqs[req.id].arr || 0 : 0;
                    tabsHtml += `<div class="edit-form-tab" data-tab="sub-${ req.id }" data-arr-id="${ req.arr_id }" data-req-id="${ req.id }">${ fieldName } (${ arrCount })</div>`;
                });

                tabsHtml += `</div>`;
            }

            // Build attributes form HTML
            let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate, typeId);

            let formHtml = `
                <div class="edit-form-header">
                    <div class="edit-form-header-title-row">
                        <h5>${ title }</h5>
                        ${ recordIdHtml }
                    </div>
                    <button class="edit-form-close" data-close-modal="true">×</button>
                </div>
                ${ tabsHtml }
                <div class="edit-form-body">
                    <div class="edit-form-tab-content active" data-tab-content="attributes">
                        <form id="edit-form" class="edit-form">
                            ${ attributesHtml }
                        </form>
                    </div>
            `;

            // Add placeholder for subordinate table contents
            if (hasSubordinateTables) {
                subordinateTables.forEach(req => {
                    formHtml += `
                        <div class="edit-form-tab-content" data-tab-content="sub-${ req.id }">
                            <div class="subordinate-table-loading">Загрузка...</div>
                        </div>
                    `;
                });
            }

            formHtml += `
                </div>
                <div class="edit-form-footer">
                    <button type="button" class="btn btn-icon form-settings-btn" id="form-settings-btn" title="Настройка видимости полей">
                        ⚙️
                    </button>
                    <div class="edit-form-footer-buttons">
                        ${ !isCreate ? '<button type="button" class="btn btn-danger" id="delete-record-btn" style="display:none;">Удалить</button>' : '' }
                        <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Store modal context for subordinate tables - ONLY for the first level (parent form)
            // Don't overwrite when opening subordinate record forms (nested modals)
            if (modalDepth === 1) {
                this.currentEditModal = {
                    modal,
                    recordId,
                    typeId,
                    metadata,
                    recordData,
                    subordinateTables,
                    recordReqs
                };
            }

            // Attach tab switching handlers
            if (hasSubordinateTables) {
                this.attachTabHandlers(modal);
            }

            // Load reference options for dropdowns (scoped to this modal)
            this.loadReferenceOptions(metadata.reqs, recordId || 0, modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach file upload handlers
            this.attachFormFileUploadHandlers(modal);

            // Attach form field settings handler
            const formSettingsBtn = modal.querySelector('#form-settings-btn');
            formSettingsBtn.addEventListener('click', () => {
                this.openFormFieldSettings(typeId, metadata);
            });

            // Apply saved field visibility settings
            this.applyFormFieldSettings(modal, typeId);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-btn');

            saveBtn.addEventListener('click', () => {
                this.saveRecord(modal, isCreate, recordId, typeId, parentId, columnId);
            });

            // Attach delete handler (edit mode only)
            if (!isCreate) {
                const deleteBtn = modal.querySelector('#delete-record-btn');
                if (deleteBtn) {
                    // Show/hide based on saved setting
                    const showDelete = this.loadFormShowDelete(typeId);
                    if (showDelete) {
                        deleteBtn.style.display = '';
                    }
                    deleteBtn.addEventListener('click', () => {
                        this.deleteRecord(modal, recordId, typeId);
                    });
                }
            }

            // Close modal helper function
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                if (modalDepth === 1) {
                    this.currentEditModal = null;
                }
            };

            // Attach close handlers to buttons with data-close-modal attribute
            modal.querySelectorAll('[data-close-modal="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);
        }

        renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate = false, typeId = null) {
            let html = '';

            // Get current date/datetime for default values in create mode
            // Only applied to the first column (where req.id equals typeId)
            let currentDateHtml5 = '';
            let currentDateTimeHtml5 = '';
            let currentDateDisplay = '';
            let currentDateTimeDisplay = '';

            if (isCreate) {
                const now = new Date();
                currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
                const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
                now.setMinutes(minutes);
                currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
                currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
                currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM
            }

            // Main value field - render according to base type
            const typeName = this.getMetadataName(metadata);
            const mainValue = recordData && recordData.obj ? recordData.obj.val : '';
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                const isChecked = mainValue ? 'checked' : '';
                mainFieldHtml = `<input type="checkbox" id="field-main" name="main" value="1" ${ isChecked }>`;
            } else if (mainFieldType === 'DATE') {
                const dateValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, false) : (isCreate ? currentDateHtml5 : '');
                const dateValueDisplay = mainValue ? this.formatDateForInput(mainValue, false) : (isCreate ? currentDateDisplay : '');
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
            } else if (mainFieldType === 'DATETIME') {
                const dateTimeValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, true) : (isCreate ? currentDateTimeHtml5 : '');
                const dateTimeValueDisplay = mainValue ? this.formatDateForInput(mainValue, true) : (isCreate ? currentDateTimeDisplay : '');
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
            } else if (mainFieldType === 'NUMBER') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
            } else if (mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required step="0.01">`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="field-main" name="main" rows="4" required>${ this.escapeHtml(mainValue) }</textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
            }

            html += `
                <div class="form-group">
                    <label for="field-main">${ typeName } <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            // Sort fields by saved order if available
            const savedFieldOrder = this.loadFormFieldOrder(typeId);
            const sortedFields = [...regularFields];
            if (savedFieldOrder.length > 0) {
                sortedFields.sort((a, b) => {
                    const idxA = savedFieldOrder.indexOf(String(a.id));
                    const idxB = savedFieldOrder.indexOf(String(b.id));
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }

            sortedFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const reqValue = recordReqs[req.id] ? recordReqs[req.id].value : '';
                const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base : req.type;
                const baseFormat = this.normalizeFormat(baseTypeId);
                const isRequired = attrs.required;

                html += `<div class="form-group">`;
                html += `<label for="field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Reference field (searchable dropdown with clear/add buttons - same as inline table editor)
                if (req.ref_id) {
                    const currentValue = reqValue || '';
                    html += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-${ req.id }"
                                   name="t${ req.id }"
                                   value="${ this.escapeHtml(currentValue) }"
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                // Boolean field
                else if (baseFormat === 'BOOLEAN') {
                    const isChecked = reqValue ? 'checked' : '';
                    const prevValue = reqValue || '';
                    html += `<input type="checkbox" id="field-${ req.id }" name="t${ req.id }" value="1" ${ isChecked }>`;
                    html += `<input type="hidden" name="b${ req.id }" value="${ this.escapeHtml(prevValue) }">`;
                }
                // Date field with HTML5 date picker
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : (isCreate && isFirstColumn ? currentDateHtml5 : '');
                    const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : (isCreate && isFirstColumn ? currentDateDisplay : '');
                    html += `<input type="date" class="form-control date-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateValueDisplay) }">`;
                }
                // DateTime field with HTML5 datetime-local picker (with time rounded to 5 minutes)
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeHtml5 : '');
                    const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeDisplay : '');
                    html += `<input type="datetime-local" class="form-control datetime-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateTimeValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
                }
                // MEMO field (multi-line text, 4 rows)
                else if (baseFormat === 'MEMO') {
                    html += `<textarea class="form-control memo-field" id="field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }>${ this.escapeHtml(reqValue) }</textarea>`;
                }
                // FILE field (file upload with drag-and-drop)
                else if (baseFormat === 'FILE') {
                    // Parse file link from HTML if present
                    let fileHref = '';
                    let fileName = '';
                    let hasFile = false;

                    if (reqValue && reqValue !== '') {
                        // Check if value contains HTML link: <a target="_blank" href="/path/to/file">filename.ext</a>
                        const linkMatch = reqValue.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/i);
                        if (linkMatch) {
                            fileHref = linkMatch[1];
                            fileName = linkMatch[2];
                            hasFile = true;
                        } else {
                            // Fallback: treat as plain file path
                            fileHref = reqValue;
                            fileName = reqValue.split('/').pop() || reqValue;
                            hasFile = true;
                        }
                    }

                    html += `
                        <div class="form-file-upload" data-req-id="${ req.id }" data-original-value="${ this.escapeHtml(reqValue) }">
                            <input type="file" class="file-input" id="field-${ req.id }-file" style="display: none;">
                            <div class="file-dropzone" style="${ hasFile ? 'display: none;' : '' }">
                                <span class="file-dropzone-text">Перетащите файл сюда или нажмите для выбора</span>
                                <button type="button" class="file-select-btn">Выбрать файл</button>
                            </div>
                            <div class="file-preview" style="${ hasFile ? 'display: flex;' : 'display: none;' }">
                                ${ fileHref ? `<a href="${ this.escapeHtml(fileHref) }" target="_blank" class="file-name file-link">${ this.escapeHtml(fileName) }</a>` : `<span class="file-name">${ this.escapeHtml(fileName) }</span>` }
                                <button type="button" class="file-remove-btn" title="Удалить файл">×</button>
                            </div>
                            <input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' } data-file-deleted="false">
                        </div>
                    `;
                }
                // Regular text field
                else {
                    html += `<input type="text" class="form-control" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' }>`;
                }

                html += `</div>`;
            });

            return html;
        }

        attachTabHandlers(modal) {
            const tabs = modal.querySelectorAll('.edit-form-tab');
            const instanceName = this.options.instanceName;

            tabs.forEach(tab => {
                tab.addEventListener('click', async () => {
                    const tabId = tab.dataset.tab;

                    // Update active tab
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Update active content
                    const contents = modal.querySelectorAll('.edit-form-tab-content');
                    contents.forEach(c => c.classList.remove('active'));

                    const targetContent = modal.querySelector(`[data-tab-content="${ tabId }"]`);
                    if (targetContent) {
                        targetContent.classList.add('active');
                    }

                    // Load subordinate table if needed
                    if (tabId.startsWith('sub-') && tab.dataset.arrId) {
                        const arrId = tab.dataset.arrId;
                        const reqId = tab.dataset.reqId;
                        const parentRecordId = this.currentEditModal.recordId;

                        // Check if already loaded
                        if (!targetContent.dataset.loaded) {
                            await this.loadSubordinateTable(targetContent, arrId, parentRecordId, reqId);
                            targetContent.dataset.loaded = 'true';
                        }
                    }

                    // Show/hide footer buttons based on tab
                    const footer = modal.querySelector('.edit-form-footer');
                    if (tabId === 'attributes') {
                        footer.style.display = 'flex';
                        // Collapse modal back to normal size
                        modal.classList.remove('expanded');
                    } else {
                        footer.style.display = 'none';
                        // Expand modal to fit subordinate table
                        modal.classList.add('expanded');
                    }
                });
            });
        }

        async loadSubordinateTable(container, arrId, parentRecordId, reqId) {
            container.innerHTML = '<div class="subordinate-table-loading">Загрузка...</div>';

            try {
                // Fetch metadata for subordinate table
                const metadata = await this.fetchMetadata(arrId);

                // Fetch data for subordinate table
                const apiBase = this.getApiBase();
                const dataUrl = `${ apiBase }/object/${ arrId }/?JSON_OBJ&F_U=${ parentRecordId }`;
                const dataResponse = await fetch(dataUrl);
                const data = await dataResponse.json();

                // Render the subordinate table
                this.renderSubordinateTable(container, metadata, data, arrId, parentRecordId);

            } catch (error) {
                console.error('Error loading subordinate table:', error);
                container.innerHTML = `<div class="subordinate-table-error">Ошибка загрузки: ${ error.message }</div>`;
            }
        }

        /**
         * Open subordinate table from a cell click in the main table
         * @param {Event} event - Click event
         * @param {number} arrId - Subordinate table type ID
         * @param {number} parentRecordId - Parent record ID
         */
        async openSubordinateTableFromCell(event, arrId, parentRecordId) {
            event.preventDefault();
            event.stopPropagation();

            try {
                // Fetch metadata for subordinate table
                const metadata = await this.fetchMetadata(arrId);

                // Create modal for subordinate table
                const modalDepth = (window._integramModalDepth || 0) + 1;
                window._integramModalDepth = modalDepth;
                const baseZIndex = 1000 + (modalDepth * 10);

                const overlay = document.createElement('div');
                overlay.className = 'edit-form-overlay subordinate-modal-overlay';
                overlay.style.zIndex = baseZIndex;
                overlay.dataset.modalDepth = modalDepth;

                const modal = document.createElement('div');
                modal.className = 'edit-form-modal subordinate-modal expanded';
                modal.style.zIndex = baseZIndex + 1;
                modal.dataset.modalDepth = modalDepth;

                const typeName = this.getMetadataName(metadata);

                modal.innerHTML = `
                    <div class="edit-form-header">
                        <h5>${ typeName }</h5>
                        <button class="edit-form-close subordinate-modal-close">×</button>
                    </div>
                    <div class="edit-form-body">
                        <div class="subordinate-table-container">
                            <div class="subordinate-table-loading">Загрузка...</div>
                        </div>
                    </div>
                `;

                document.body.appendChild(overlay);
                document.body.appendChild(modal);

                // Load subordinate table data
                const container = modal.querySelector('.subordinate-table-container');
                await this.loadSubordinateTable(container, arrId, parentRecordId, null);

                // Track context so save handlers can refresh this subordinate table
                this.cellSubordinateContext = {
                    container,
                    arrId,
                    parentRecordId
                };

                // Close handler
                const closeModal = () => {
                    modal.remove();
                    overlay.remove();
                    window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                    this.cellSubordinateContext = null;
                };

                modal.querySelector('.subordinate-modal-close').addEventListener('click', closeModal);
                overlay.addEventListener('click', closeModal);

            } catch (error) {
                console.error('Error opening subordinate table:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        renderSubordinateTable(container, metadata, data, arrId, parentRecordId, sortState = null, searchTerm = '') {
            const instanceName = this.options.instanceName;
            let rows = Array.isArray(data) ? [...data] : [];
            const reqs = metadata.reqs || [];

            // Initialize sort state if not provided (multi-column sorting support)
            // sortState is an array of {colIndex, direction} objects, sorted by priority
            if (!sortState) {
                sortState = [];
            }

            // Store original data and state on container for re-rendering
            container._subordinateData = data;
            container._subordinateMetadata = metadata;
            container._subordinateArrId = arrId;
            container._subordinateParentRecordId = parentRecordId;
            container._subordinateSortState = sortState;
            container._subordinateSearchTerm = searchTerm;

            // Build column info for sorting (includes type information)
            const columns = [
                { name: this.getMetadataName(metadata), type: metadata.type, index: 0 }
            ];
            reqs.forEach((req, idx) => {
                const attrs = this.parseAttrs(req.attrs);
                columns.push({
                    name: attrs.alias || req.val,
                    type: req.type,
                    index: idx + 1,
                    arr_id: req.arr_id
                });
            });

            // Apply multi-column sorting (client-side)
            if (sortState.length > 0) {
                rows = this.sortSubordinateRows(rows, sortState, columns);
            }

            // Apply search filter (client-side)
            if (searchTerm && searchTerm.trim() !== '') {
                rows = this.filterSubordinateRows(rows, searchTerm.trim(), columns);
            }

            let html = `
                <div class="subordinate-table-toolbar">
                    <button type="button" class="btn btn-sm btn-primary subordinate-add-btn" data-arr-id="${ arrId }" data-parent-id="${ parentRecordId }">
                        + Добавить
                    </button>
                    <div class="subordinate-search-wrapper">
                        <input type="text" class="subordinate-search-input" placeholder="Поиск..." value="${ this.escapeHtml(searchTerm) }">
                        <button type="button" class="subordinate-search-clear" title="Очистить поиск"${ searchTerm ? '' : ' style="display: none;"' }>×</button>
                    </div>
                </div>
            `;

            if (rows.length === 0) {
                const emptyMessage = searchTerm ? 'Ничего не найдено' : 'Нет записей';
                html += `<div class="subordinate-table-empty">${ emptyMessage }</div>`;
            } else {
                html += `<div class="subordinate-table-wrapper"><table class="subordinate-table"><thead><tr>`;

                // Header: main value column + requisite columns (with sort indicators)
                columns.forEach((col, colIdx) => {
                    // Find sort state for this column
                    const sortInfo = sortState.find(s => s.colIndex === colIdx);
                    const sortIndicator = sortInfo ? (sortInfo.direction === 'asc' ? ' ▲' : ' ▼') : '';
                    const sortPriority = sortInfo ? sortState.indexOf(sortInfo) + 1 : '';
                    const priorityBadge = sortState.length > 1 && sortPriority ? `<span class="subordinate-sort-priority">${ sortPriority }</span>` : '';

                    html += `<th class="subordinate-sortable-header" data-col-index="${ colIdx }">${ col.name }${ sortIndicator }${ priorityBadge }</th>`;
                });

                html += `</tr></thead><tbody>`;

                // Data rows
                rows.forEach(row => {
                    const rowId = row.i;
                    const values = row.r || [];

                    html += `<tr data-row-id="${ rowId }">`;

                    // First column (main value) - clickable to edit
                    const mainValue = values[0] || '';
                    const mainFieldInfo = { type: metadata.type };
                    let displayMainValue = this.formatSubordinateCellValue(mainValue, mainFieldInfo);
                    if (searchTerm) {
                        displayMainValue = this.highlightSearchTerm(displayMainValue, searchTerm);
                    }
                    html += `<td class="subordinate-cell-clickable" data-row-id="${ rowId }" data-type-id="${ arrId }">${ displayMainValue }</td>`;

                    // Other columns
                    reqs.forEach((req, idx) => {
                        const cellValue = values[idx + 1] !== undefined ? values[idx + 1] : '';

                        if (req.arr_id) {
                            const count = typeof cellValue === 'number' ? cellValue : (cellValue || 0);
                            html += `<td class="subordinate-nested-count">(${ count })</td>`;
                        } else {
                            let displayValue = this.formatSubordinateCellValue(cellValue, req);
                            if (searchTerm) {
                                displayValue = this.highlightSearchTerm(displayValue, searchTerm);
                            }
                            html += `<td>${ displayValue }</td>`;
                        }
                    });

                    html += `</tr>`;
                });

                html += `</tbody></table></div>`;
            }

            container.innerHTML = html;

            // Attach click handlers for editing rows
            const clickableCells = container.querySelectorAll('.subordinate-cell-clickable');
            clickableCells.forEach(cell => {
                cell.addEventListener('click', () => {
                    const rowId = cell.dataset.rowId;
                    const typeId = cell.dataset.typeId;
                    this.openEditForm(rowId, typeId, 0);
                });
            });

            // Attach add button handler
            const addBtn = container.querySelector('.subordinate-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.createSubordinateRecord(arrId, parentRecordId);
                });
            }

            // Attach sortable column header handlers
            const sortableHeaders = container.querySelectorAll('.subordinate-sortable-header');
            sortableHeaders.forEach(th => {
                th.addEventListener('click', () => {
                    const colIndex = parseInt(th.dataset.colIndex, 10);
                    this.handleSubordinateSort(container, colIndex);
                });
            });

            // Attach search input handler
            const searchInput = container.querySelector('.subordinate-search-input');
            const searchClear = container.querySelector('.subordinate-search-clear');

            if (searchInput) {
                let debounceTimer;
                searchInput.addEventListener('input', (e) => {
                    const newSearchTerm = e.target.value;
                    searchClear.style.display = newSearchTerm ? '' : 'none';

                    // Debounce search to avoid excessive re-renders
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this.renderSubordinateTable(
                            container,
                            container._subordinateMetadata,
                            container._subordinateData,
                            container._subordinateArrId,
                            container._subordinateParentRecordId,
                            container._subordinateSortState,
                            newSearchTerm
                        );
                    }, 200);
                });
            }

            if (searchClear) {
                searchClear.addEventListener('click', () => {
                    this.renderSubordinateTable(
                        container,
                        container._subordinateMetadata,
                        container._subordinateData,
                        container._subordinateArrId,
                        container._subordinateParentRecordId,
                        container._subordinateSortState,
                        ''
                    );
                });
            }
        }

        /**
         * Handle column sort click in subordinate table
         * Implements 3-state sorting: no sort -> asc -> desc -> no sort
         * Supports multi-column sorting with priority
         */
        handleSubordinateSort(container, colIndex) {
            let sortState = container._subordinateSortState || [];
            const existingIdx = sortState.findIndex(s => s.colIndex === colIndex);

            if (existingIdx === -1) {
                // Column not sorted - add as ascending (highest priority = last in array)
                sortState.push({ colIndex, direction: 'asc' });
            } else {
                const existing = sortState[existingIdx];
                if (existing.direction === 'asc') {
                    // Currently ascending - switch to descending
                    sortState[existingIdx].direction = 'desc';
                } else {
                    // Currently descending - remove sort
                    sortState.splice(existingIdx, 1);
                }
            }

            // Re-render with new sort state
            this.renderSubordinateTable(
                container,
                container._subordinateMetadata,
                container._subordinateData,
                container._subordinateArrId,
                container._subordinateParentRecordId,
                sortState,
                container._subordinateSearchTerm || ''
            );
        }

        /**
         * Sort subordinate table rows (multi-column support)
         */
        sortSubordinateRows(rows, sortState, columns) {
            return [...rows].sort((a, b) => {
                for (const sort of sortState) {
                    const col = columns[sort.colIndex];
                    const valA = (a.r || [])[sort.colIndex];
                    const valB = (b.r || [])[sort.colIndex];

                    const comparison = this.compareSubordinateValues(valA, valB, col.type);
                    if (comparison !== 0) {
                        return sort.direction === 'asc' ? comparison : -comparison;
                    }
                }
                return 0;
            });
        }

        /**
         * Compare two values for sorting, respecting their type
         */
        compareSubordinateValues(a, b, type) {
            // Handle null/undefined/empty
            const aEmpty = a === null || a === undefined || a === '';
            const bEmpty = b === null || b === undefined || b === '';

            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;  // Empty values go to end
            if (bEmpty) return -1;

            const baseFormat = this.normalizeFormat(type);

            // For reference values (id:label format), extract the label for comparison
            let valA = a;
            let valB = b;
            if (typeof a === 'string' && a.includes(':')) {
                const parts = a.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    valA = parts.slice(1).join(':');
                }
            }
            if (typeof b === 'string' && b.includes(':')) {
                const parts = b.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    valB = parts.slice(1).join(':');
                }
            }

            switch (baseFormat) {
                case 'NUMBER':
                case 'SIGNED':
                    const numA = parseFloat(valA);
                    const numB = parseFloat(valB);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                    }
                    break;
                case 'DATE':
                    const dateA = this.parseDDMMYYYY(String(valA));
                    const dateB = this.parseDDMMYYYY(String(valB));
                    if (dateA && dateB) {
                        return dateA.getTime() - dateB.getTime();
                    }
                    break;
                case 'DATETIME':
                    const dtA = this.parseDDMMYYYYHHMMSS(String(valA));
                    const dtB = this.parseDDMMYYYYHHMMSS(String(valB));
                    if (dtA && dtB) {
                        return dtA.getTime() - dtB.getTime();
                    }
                    break;
                case 'BOOLEAN':
                    const boolA = valA !== null && valA !== undefined && valA !== '' && valA !== 0 && valA !== '0' && valA !== false;
                    const boolB = valB !== null && valB !== undefined && valB !== '' && valB !== 0 && valB !== '0' && valB !== false;
                    return (boolA === boolB) ? 0 : (boolA ? -1 : 1);
            }

            // Default: string comparison (case-insensitive)
            return String(valA).toLowerCase().localeCompare(String(valB).toLowerCase(), 'ru');
        }

        /**
         * Filter subordinate table rows by search term (searches all fields)
         */
        filterSubordinateRows(rows, searchTerm, columns) {
            const term = searchTerm.toLowerCase();
            return rows.filter(row => {
                const values = row.r || [];
                return values.some((val, idx) => {
                    if (val === null || val === undefined) return false;

                    // For reference values, extract the label
                    let searchVal = String(val);
                    if (typeof val === 'string' && val.includes(':')) {
                        const parts = val.split(':');
                        if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                            searchVal = parts.slice(1).join(':');
                        }
                    }

                    return searchVal.toLowerCase().includes(term);
                });
            });
        }

        /**
         * Highlight search term in text (for display)
         */
        highlightSearchTerm(text, searchTerm) {
            if (!searchTerm || !text) return text;

            // Don't highlight inside HTML tags
            const term = searchTerm.toLowerCase();
            const textLower = text.toLowerCase();

            if (!textLower.includes(term)) return text;

            // Simple highlight - replace matches with highlighted version
            // Using a case-insensitive regex with capturing group
            const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedTerm})`, 'gi');

            return text.replace(regex, '<mark class="subordinate-search-highlight">$1</mark>');
        }

        formatSubordinateCellValue(value, req) {
            if (value === null || value === undefined || value === '') {
                return '';
            }

            // Format based on type if req is provided - check this BEFORE reference value parsing
            if (req) {
                const baseFormat = this.normalizeFormat(req.type);

                switch (baseFormat) {
                    case 'BOOLEAN':
                        // Display as checkbox icon: any non-empty value = YES, empty = NO
                        const boolVal = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== false;
                        return boolVal ? '<span class="boolean-check">✓</span>' : '<span class="boolean-uncheck">✗</span>';
                    case 'DATE':
                        if (value) {
                            const dateObj = this.parseDDMMYYYY(value);
                            if (dateObj && !isNaN(dateObj.getTime())) {
                                return this.formatDateDisplay(dateObj);
                            }
                        }
                        break;
                    case 'DATETIME':
                        if (value) {
                            const datetimeObj = this.parseDDMMYYYYHHMMSS(value);
                            if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                                return this.formatDateTimeDisplay(datetimeObj);
                            }
                        }
                        break;
                    case 'FILE':
                        // Check if value is already an HTML anchor tag (from object/ endpoint)
                        if (typeof value === 'string' && value.trim().startsWith('<a')) {
                            // Value is already HTML link - add file-link class and return as-is
                            return value.replace('<a', '<a class="file-link"');
                        }
                        break;
                }
            }

            // Handle reference values (format: "id:label")
            // This must come AFTER type-based formatting to avoid misinterpreting datetime values as references
            if (typeof value === 'string' && value.includes(':')) {
                const parts = value.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    // It's a reference value, show the label
                    return this.escapeHtml(parts.slice(1).join(':'));
                }
            }

            return this.escapeHtml(String(value));
        }

        async createSubordinateRecord(arrId, parentRecordId) {
            try {
                // Fetch metadata for the subordinate table type
                if (!this.metadataCache[arrId]) {
                    this.metadataCache[arrId] = await this.fetchMetadata(arrId);
                }

                const metadata = this.metadataCache[arrId];

                // Open create form with parent ID
                this.renderSubordinateCreateForm(metadata, arrId, parentRecordId);

            } catch (error) {
                console.error('Error creating subordinate record:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        renderSubordinateCreateForm(metadata, arrId, parentRecordId) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            // Create a new form modal for subordinate record
            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay subordinate-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal subordinate-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${ typeName }`;

            // Build form for regular fields only (no nested subordinate tables in create mode)
            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            // Determine the type of the main (first column) field
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Get current date/datetime for default values
            const now = new Date();
            const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
            now.setMinutes(minutes);
            const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
            const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
            const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                mainFieldHtml = `<input type="checkbox" id="sub-field-main" name="main" value="1">`;
            } else if (mainFieldType === 'DATE') {
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="sub-field-main-picker" required data-target="sub-field-main" value="${ currentDateHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateDisplay }">`;
            } else if (mainFieldType === 'DATETIME') {
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-main-picker" required data-target="sub-field-main" value="${ currentDateTimeHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateTimeDisplay }">`;
            } else if (mainFieldType === 'NUMBER' || mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="sub-field-main" name="main" value="" required ${ mainFieldType === 'SIGNED' ? 'step="0.01"' : '' }>`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="sub-field-main" name="main" rows="4" required></textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="sub-field-main" name="main" value="" required>`;
            }

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${ title }</h5>
                    <button class="edit-form-close subordinate-close-btn">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="subordinate-edit-form" class="edit-form">
                        <div class="form-group">
                            <label for="sub-field-main">${ typeName } <span class="required">*</span></label>
                            ${ mainFieldHtml }
                        </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const baseFormat = this.normalizeFormat(req.type);
                const isRequired = attrs.required;

                formHtml += `<div class="form-group">`;
                formHtml += `<label for="sub-field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Reference field (searchable dropdown with clear/add buttons - same as inline table editor)
                if (req.ref_id) {
                    formHtml += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="sub-field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="sub-field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="sub-field-${ req.id }"
                                   name="t${ req.id }"
                                   value=""
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                else if (baseFormat === 'BOOLEAN') {
                    formHtml += `<input type="checkbox" id="sub-field-${ req.id }" name="t${ req.id }" value="1">`;
                }
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateValue = isFirstColumn ? currentDateHtml5 : '';
                    const dateDisplay = isFirstColumn ? currentDateDisplay : '';
                    formHtml += `<input type="date" class="form-control date-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" value="${ dateValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateDisplay }">`;
                }
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateTimeValue = isFirstColumn ? currentDateTimeHtml5 : '';
                    const dateTimeDisplay = isFirstColumn ? currentDateTimeDisplay : '';
                    formHtml += `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" value="${ dateTimeValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateTimeDisplay }">`;
                }
                else if (baseFormat === 'MEMO') {
                    formHtml += `<textarea class="form-control memo-field" id="sub-field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }></textarea>`;
                }
                else {
                    formHtml += `<input type="text" class="form-control" id="sub-field-${ req.id }" name="t${ req.id }" value="" ${ isRequired ? 'required' : '' }>`;
                }

                formHtml += `</div>`;
            });

            formHtml += `
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="subordinate-save-btn">Создать</button>
                        <button type="button" class="btn btn-secondary subordinate-cancel-btn">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options (scoped to this modal)
            this.loadReferenceOptions(regularFields, 0, modal);

            // Attach date picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach file upload handlers
            this.attachFormFileUploadHandlers(modal);

            // Close handlers
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelector('.subordinate-close-btn').addEventListener('click', closeModal);
            modal.querySelector('.subordinate-cancel-btn').addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            // Save handler
            modal.querySelector('#subordinate-save-btn').addEventListener('click', async () => {
                const form = modal.querySelector('#subordinate-edit-form');

                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                const formData = new FormData(form);
                const params = new URLSearchParams();

                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Skip empty parameters when creating so server can fill defaults
                for (const [key, value] of formData.entries()) {
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                const mainValue = formData.get('main');
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append('t0', mainValue);
                }

                const apiBase = this.getApiBase();
                const url = `${ apiBase }/_m_new/${ arrId }?JSON&up=${ parentRecordId }`;

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

                    if (result.error) {
                        throw new Error(result.error);
                    }

                    closeModal();
                    this.showToast('Запись создана', 'success');

                    // Reload the subordinate table
                    if (this.currentEditModal) {
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ this.currentEditModal.subordinateTables.find(t => t.arr_id === arrId)?.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, arrId, parentRecordId);
                            tabContent.dataset.loaded = 'true';

                            // Update tab count
                            const tab = this.currentEditModal.modal.querySelector(`[data-arr-id="${ arrId }"]`);
                            if (tab) {
                                const currentText = tab.textContent;
                                const match = currentText.match(/^(.+)\s*\((\d+)\)$/);
                                if (match) {
                                    const newCount = parseInt(match[2]) + 1;
                                    tab.textContent = `${ match[1] } (${ newCount })`;
                                }
                            }
                        }
                    }

                    // Reload subordinate table opened from cell
                    if (this.cellSubordinateContext && this.cellSubordinateContext.arrId === arrId) {
                        await this.loadSubordinateTable(this.cellSubordinateContext.container, arrId, parentRecordId);
                    }

                } catch (error) {
                    console.error('Error creating subordinate record:', error);
                    this.showToast(`Ошибка: ${ error.message }`, 'error');
                }
            });
        }

        attachDatePickerHandlers(modal) {
            // Handle date pickers
            const datePickers = modal.querySelectorAll('.date-picker');
            datePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, false);
                        hiddenInput.value = displayValue;
                    }
                });
            });

            // Handle datetime pickers
            const datetimePickers = modal.querySelectorAll('.datetime-picker');
            datetimePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, true);
                        hiddenInput.value = displayValue;
                    }
                });
            });
        }

        attachFormFileUploadHandlers(modal) {
            const fileUploads = modal.querySelectorAll('.form-file-upload');
            fileUploads.forEach(uploadContainer => {
                const reqId = uploadContainer.dataset.reqId;
                const fileInput = uploadContainer.querySelector('.file-input');
                const dropzone = uploadContainer.querySelector('.file-dropzone');
                const selectBtn = uploadContainer.querySelector('.file-select-btn');
                const preview = uploadContainer.querySelector('.file-preview');
                const fileName = uploadContainer.querySelector('.file-name');
                const removeBtn = uploadContainer.querySelector('.file-remove-btn');
                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                // Click to select file
                selectBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fileInput.click();
                });

                // Dropzone click
                dropzone.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fileInput.click();
                });

                // File input change
                fileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        await this.handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput);
                    }
                    // Reset file input so selecting the same file again triggers change
                    fileInput.value = '';
                });

                // Drag and drop handlers
                dropzone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.add('drag-over');
                });

                dropzone.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('drag-over');
                });

                dropzone.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('drag-over');

                    const file = e.dataTransfer.files[0];
                    if (file) {
                        await this.handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput);
                    }
                });

                // Remove file button
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Check if this is an existing file (has original value) or newly uploaded
                    const originalValue = uploadContainer.dataset.originalValue || '';
                    if (originalValue) {
                        // Mark as deleted for existing files
                        hiddenInput.dataset.fileDeleted = 'true';
                    }
                    // Clear UI
                    const fileNameElement = preview.querySelector('.file-name');
                    if (fileNameElement.tagName === 'A') {
                        fileNameElement.outerHTML = `<span class="file-name"></span>`;
                    } else {
                        fileNameElement.textContent = '';
                    }
                    dropzone.style.display = 'flex';
                    preview.style.display = 'none';
                    fileInput.value = '';
                    hiddenInput.value = '';
                });
            });
        }

        async handleFormFileSelection(file, uploadContainer, dropzone, preview, fileName, hiddenInput) {
            // Show loading state
            const dropzoneText = dropzone.querySelector('.file-dropzone-text');
            const originalText = dropzoneText.textContent;
            dropzoneText.textContent = 'Загрузка...';

            try {
                // Store the file object in the upload container for later submission
                uploadContainer._fileToUpload = file;

                // Update UI - replace link with plain text since it's a new upload
                if (fileName.tagName === 'A') {
                    fileName.outerHTML = `<span class="file-name">${ this.escapeHtml(file.name) }</span>`;
                } else {
                    fileName.textContent = file.name;
                }
                dropzone.style.display = 'none';
                preview.style.display = 'flex';

                // Mark that a new file is selected (will be uploaded on save)
                hiddenInput.value = file.name; // Store filename temporarily
                hiddenInput.dataset.fileDeleted = 'false';
                hiddenInput.dataset.hasNewFile = 'true';

                dropzoneText.textContent = originalText;
            } catch (error) {
                console.error('Error preparing file:', error);
                this.showToast(`Ошибка подготовки файла: ${ error.message }`, 'error');
                dropzoneText.textContent = originalText;
            }
        }

        async loadReferenceOptions(reqs, recordId, modalElement) {
            // Load reference options for the new form-reference-editor elements
            // Scope query to the specific modal to avoid affecting other open modals
            const container = modalElement || document;
            const formRefEditors = container.querySelectorAll('.form-reference-editor');

            for (const wrapper of formRefEditors) {
                const refReqId = wrapper.dataset.refId;
                const refTypeId = wrapper.dataset.refTypeId;
                const searchInput = wrapper.querySelector('.form-ref-search');
                const dropdown = wrapper.querySelector('.form-ref-dropdown');
                const hiddenInput = wrapper.querySelector('.form-ref-value');
                const clearButton = wrapper.querySelector('.form-ref-clear');
                const addButton = wrapper.querySelector('.form-ref-add');

                if (!searchInput || !dropdown || !hiddenInput) continue;

                try {
                    const options = await this.fetchReferenceOptions(refReqId, recordId);

                    // Store options data on the wrapper (array of [id, text] tuples)
                    wrapper._referenceOptions = options;
                    wrapper._allOptionsFetched = options.length < 50;

                    // Render options (hidden by default, shown on focus)
                    this.renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput);
                    dropdown.style.display = 'none';

                    // Set current value if exists
                    if (hiddenInput.value) {
                        const currentOption = options.find(([id]) => id === hiddenInput.value);
                        if (currentOption) {
                            searchInput.value = currentOption[1];
                        }
                    }

                    // Handle search input
                    let searchTimeout;
                    searchInput.addEventListener('input', async (e) => {
                        const searchText = e.target.value.trim();

                        // Toggle buttons based on search input length (like inline editor)
                        if (searchText.length > 0) {
                            if (addButton) addButton.style.display = '';
                            if (clearButton) clearButton.style.display = 'none';
                        } else {
                            if (addButton) addButton.style.display = 'none';
                            if (clearButton) clearButton.style.display = '';
                        }

                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(async () => {
                            if (searchText === '') {
                                this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            } else {
                                // Filter locally first (options is array of [id, text] tuples)
                                const filtered = wrapper._referenceOptions.filter(([id, text]) =>
                                    text.toLowerCase().includes(searchText.toLowerCase())
                                );
                                this.renderFormReferenceOptions(dropdown, filtered, hiddenInput, searchInput);

                                // If not all fetched, re-query from server
                                if (!wrapper._allOptionsFetched) {
                                    try {
                                        const serverOptions = await this.fetchReferenceOptions(refReqId, recordId, searchText, wrapper._extraParams || {});
                                        wrapper._referenceOptions = serverOptions;
                                        this.renderFormReferenceOptions(dropdown, serverOptions, hiddenInput, searchInput);
                                    } catch (error) {
                                        console.error('Error re-querying reference options:', error);
                                    }
                                }
                            }
                            dropdown.style.display = 'block';
                        }, 300);
                    });

                    // Show dropdown on focus
                    searchInput.addEventListener('focus', () => {
                        dropdown.style.display = 'block';
                    });

                    // Handle keyboard navigation
                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.focus();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.click();
                        }
                    });

                    // Handle keyboard navigation in dropdown
                    dropdown.addEventListener('keydown', (e) => {
                        const currentOption = document.activeElement;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const nextOption = currentOption.nextElementSibling;
                            if (nextOption && nextOption.classList.contains('inline-editor-reference-option')) nextOption.focus();
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prevOption = currentOption.previousElementSibling;
                            if (prevOption && prevOption.classList.contains('inline-editor-reference-option')) {
                                prevOption.focus();
                            } else {
                                searchInput.focus();
                            }
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            currentOption.click();
                        }
                    });

                    // Handle option selection via click delegation
                    dropdown.addEventListener('click', (e) => {
                        const option = e.target.closest('.inline-editor-reference-option');
                        if (option) {
                            hiddenInput.value = option.dataset.id;
                            searchInput.value = option.dataset.text;
                            dropdown.style.display = 'none';
                            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });

                    // Handle clear button
                    if (clearButton) {
                        clearButton.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            hiddenInput.value = '';
                            searchInput.value = '';
                            this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            dropdown.style.display = 'block';
                            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                    }

                    // Handle add button (create new record)
                    if (addButton && refTypeId) {
                        addButton.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const inputValue = searchInput.value.trim();
                            await this.openCreateFormForFormReference(refTypeId, inputValue, recordId, hiddenInput, searchInput, wrapper, dropdown);
                        });
                    }

                    // Hide dropdown when clicking outside the reference editor wrapper
                    document.addEventListener('click', (e) => {
                        if (!wrapper.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });

                } catch (error) {
                    console.error('Error loading reference options:', error);
                    dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
                }
            }

            // Set up field hooks from integramTableOverrides.fieldHooks
            // Hook format:
            //   { watch: 443, target: 4874, onEmpty: { FR_partners: '%' }, onFilled: { FR_partners: '!%' } }
            // When the watched field changes, extra params are applied to target field's dropdown query.
            const hooks = window.integramTableOverrides && window.integramTableOverrides.fieldHooks;
            if (hooks && Array.isArray(hooks)) {
                for (const hook of hooks) {
                    const watchId = String(hook.watch);
                    const targetId = String(hook.target);
                    const watchedWrapper = container.querySelector(`.form-reference-editor[data-ref-id="${ watchId }"]`);
                    const targetWrapper = container.querySelector(`.form-reference-editor[data-ref-id="${ targetId }"]`);
                    if (!watchedWrapper || !targetWrapper) continue;

                    const watchedHiddenInput = watchedWrapper.querySelector('.form-ref-value');
                    const targetHiddenInput = targetWrapper.querySelector('.form-ref-value');
                    const targetSearchInput = targetWrapper.querySelector('.form-ref-search');
                    const targetDropdown = targetWrapper.querySelector('.form-ref-dropdown');
                    if (!watchedHiddenInput || !targetHiddenInput || !targetSearchInput || !targetDropdown) continue;

                    const refReqId = targetWrapper.dataset.refId;

                    const applyHook = async () => {
                        const isEmpty = !watchedHiddenInput.value;
                        targetWrapper._extraParams = isEmpty ? (hook.onEmpty || {}) : (hook.onFilled || {});
                        try {
                            const options = await this.fetchReferenceOptions(refReqId, recordId, '', targetWrapper._extraParams);
                            targetWrapper._referenceOptions = options;
                            targetWrapper._allOptionsFetched = options.length < 50;
                            this.renderFormReferenceOptions(targetDropdown, options, targetHiddenInput, targetSearchInput);
                            targetDropdown.style.display = 'none';
                        } catch (error) {
                            console.error('Error reloading reference options for hook target:', error);
                        }
                    };

                    watchedHiddenInput.addEventListener('change', applyHook);
                    // Also apply immediately on form open based on current watched field value
                    applyHook();
                }
            }
        }

        renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput) {
            // options is an array of [id, text] tuples
            dropdown.innerHTML = '';

            if (options.length === 0) {
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                return;
            }

            options.forEach(([id, text]) => {
                const escapedText = this.escapeHtml(text);
                const optionDiv = document.createElement('div');
                optionDiv.className = 'inline-editor-reference-option';
                optionDiv.textContent = text;
                optionDiv.dataset.id = id;
                optionDiv.dataset.text = text;
                optionDiv.tabIndex = 0;

                // Highlight if selected
                if (hiddenInput.value === id) {
                    optionDiv.style.backgroundColor = 'var(--md-selected)';
                    optionDiv.style.color = 'var(--md-primary)';
                    optionDiv.style.fontWeight = '500';
                }

                dropdown.appendChild(optionDiv);
            });
        }

        async openCreateFormForFormReference(typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            // Open a create form for new record from form reference field
            // After creation, set the newly created record ID and value in the reference field
            try {
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];
                this.renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);

            } catch (error) {
                console.error('Error opening create form for form reference:', error);
                this.showToast(`Ошибка открытия формы: ${error.message}`, 'error');
            }
        }

        renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
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

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${typeName}`;

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
                mainFieldHtml = `<input type="checkbox" id="field-main-form-ref-create" name="main" value="1" ${ isChecked }>`;
            } else if (mainFieldType === 'DATE') {
                const dateValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, false) : currentDateHtml5;
                const dateValueDisplay = initialValue ? this.formatDateForInput(initialValue, false) : currentDateDisplay;
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-form-ref-create-picker" required data-target="field-main-form-ref-create" value="${ this.escapeHtml(dateValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
            } else if (mainFieldType === 'DATETIME') {
                const dateTimeValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, true) : currentDateTimeHtml5;
                const dateTimeValueDisplay = initialValue ? this.formatDateForInput(initialValue, true) : currentDateTimeDisplay;
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-form-ref-create-picker" required data-target="field-main-form-ref-create" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
            } else if (mainFieldType === 'NUMBER') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required>`;
            } else if (mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-form-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required step="0.01">`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="field-main-form-ref-create" name="main" rows="4" required>${ this.escapeHtml(initialValue) }</textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="field-main-form-ref-create" name="main" value="${this.escapeHtml(initialValue)}" required>`;
            }

            let attributesHtml = `
                <div class="form-group">
                    <label for="field-main-form-ref-create">${typeName} <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                attributesHtml += `<label for="field-form-ref-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

                // Check if this is a reference field
                if (req.ref_id) {
                    // Render as reference dropdown (same as in edit form)
                    attributesHtml += `
                        <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-form-ref-${req.id}-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-form-ref-${req.id}-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-form-ref-${req.id}"
                                   name="t${req.id}"
                                   value=""
                                   data-ref-id="${req.id}">
                        </div>
                    `;
                } else {
                    // Render as simple text input
                    attributesHtml += `<input type="text" class="form-control" id="field-form-ref-${req.id}" name="t${req.id}"${isRequired ? ' required' : ''}>`;
                }

                attributesHtml += `</div>`;
            });

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${title}</h5>
                    <button class="edit-form-close" data-close-form-ref-modal="true">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-form-ref-create" class="edit-form">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-form-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-form-ref-modal="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-form-ref-btn');
            saveBtn.addEventListener('click', async () => {
                await this.saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);
            });

            // Close modal helper
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelectorAll('[data-close-form-ref-modal="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);
        }

        async saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            const form = modal.querySelector('#edit-form-form-ref-create');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const params = new URLSearchParams();

            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            const mainValue = formData.get('main');

            for (const [key, value] of formData.entries()) {
                if (key === 'main') continue;
                if (value !== '' && value !== null && value !== undefined) {
                    params.append(key, value);
                }
            }

            if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                params.append(`t${ typeId }`, mainValue);
            }

            const apiBase = this.getApiBase();
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=1`;

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
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    result = { success: true };
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                const createdId = result.obj || result.id || result.i;
                const createdValue = result.val || mainValue;


                // Close the create form modal
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                this.showToast('Запись успешно создана', 'success');

                // Set the created record in the form reference field
                if (createdId) {
                    hiddenInput.value = createdId;
                    searchInput.value = createdValue;
                    dropdown.style.display = 'none';

                    // Re-fetch options to include the new record
                    try {
                        const refReqId = wrapper.dataset.refId;
                        const newOptions = await this.fetchReferenceOptions(refReqId, parentRecordId);
                        wrapper._referenceOptions = newOptions;
                    } catch (err) {
                        console.error('Error re-fetching reference options:', err);
                    }
                }

            } catch (error) {
                console.error('Error saving record for form reference:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            }
        }

        // Form field visibility settings
        openFormFieldSettings(typeId, metadata) {
            const overlay = document.createElement('div');
            overlay.className = 'form-field-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'form-field-settings-modal';

            const visibleFields = this.loadFormFieldVisibility(typeId);
            const savedOrder = this.loadFormFieldOrder(typeId);
            const showDelete = this.loadFormShowDelete(typeId);

            // Sort requisites by saved order (if any), preserving original order for unsaved ones
            const reqs = metadata.reqs || [];
            const sortedReqs = [...reqs];
            if (savedOrder.length > 0) {
                sortedReqs.sort((a, b) => {
                    const idxA = savedOrder.indexOf(String(a.id));
                    const idxB = savedOrder.indexOf(String(b.id));
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }

            let modalHtml = `
                <div class="form-field-settings-header">
                    <h5>Настройка полей формы</h5>
                    <button class="form-field-settings-close">&times;</button>
                </div>
                <div class="form-field-settings-body">
                    <p class="form-field-settings-info">Перетаскивайте поля для изменения порядка, снимите галку для скрытия:</p>
                    <div class="form-field-settings-list">
            `;

            // Add draggable checkbox for each requisite
            sortedReqs.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const fieldId = req.id;
                const isChecked = visibleFields[fieldId] !== false;

                modalHtml += `
                    <div class="form-field-settings-item" draggable="true" data-field-id="${ fieldId }">
                        <label>
                            <span class="drag-handle">☰</span>
                            <input type="checkbox"
                                   class="form-field-visibility-checkbox"
                                   data-field-id="${ fieldId }"
                                   ${ isChecked ? 'checked' : '' }>
                            <span>${ fieldName }</span>
                        </label>
                    </div>
                `;
            });

            modalHtml += `
                    </div>
                </div>
                <div class="form-field-settings-extra">
                    <label>
                        <input type="checkbox" id="form-show-delete-checkbox" ${ showDelete ? 'checked' : '' }>
                        <span>Показывать кнопку «Удалить»</span>
                    </label>
                </div>
                <div class="form-field-settings-footer">
                    <button type="button" class="btn btn-primary form-field-settings-save">Сохранить</button>
                    <button type="button" class="btn btn-secondary form-field-settings-cancel">Отмена</button>
                </div>
            `;

            modal.innerHTML = modalHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Drag-and-drop reordering
            const list = modal.querySelector('.form-field-settings-list');
            let dragItem = null;

            list.addEventListener('dragstart', (e) => {
                dragItem = e.target.closest('.form-field-settings-item');
                if (dragItem) dragItem.classList.add('dragging');
            });

            list.addEventListener('dragend', () => {
                if (dragItem) dragItem.classList.remove('dragging');
                list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
                dragItem = null;
            });

            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                const target = e.target.closest('.form-field-settings-item');
                if (target && target !== dragItem) {
                    list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
                    target.classList.add('drag-over');
                }
            });

            list.addEventListener('drop', (e) => {
                e.preventDefault();
                const target = e.target.closest('.form-field-settings-item');
                if (target && target !== dragItem && dragItem) {
                    list.insertBefore(dragItem, target);
                }
                list.querySelectorAll('.form-field-settings-item').forEach(el => el.classList.remove('drag-over'));
            });

            // Attach handlers
            const closeBtn = modal.querySelector('.form-field-settings-close');
            const cancelBtn = modal.querySelector('.form-field-settings-cancel');
            const saveBtn = modal.querySelector('.form-field-settings-save');

            const closeModal = () => {
                modal.remove();
                overlay.remove();
            };

            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            saveBtn.addEventListener('click', () => {
                // Save visibility
                const checkboxes = modal.querySelectorAll('.form-field-visibility-checkbox');
                const visibility = {};
                checkboxes.forEach(checkbox => {
                    const fieldId = checkbox.dataset.fieldId;
                    visibility[fieldId] = checkbox.checked;
                });
                this.saveFormFieldVisibility(typeId, visibility);

                // Save field order
                const items = modal.querySelectorAll('.form-field-settings-item');
                const order = Array.from(items).map(item => item.dataset.fieldId);
                this.saveFormFieldOrder(typeId, order);

                // Save show delete setting
                const showDeleteCheckbox = modal.querySelector('#form-show-delete-checkbox');
                this.saveFormShowDelete(typeId, showDeleteCheckbox.checked);

                closeModal();

                // Apply settings to the edit form if it's open
                const editFormModal = document.querySelector('.edit-form-modal');
                if (editFormModal) {
                    this.applyFormFieldSettings(editFormModal, typeId);

                    // Update delete button visibility
                    const deleteBtn = editFormModal.querySelector('#delete-record-btn');
                    if (deleteBtn) {
                        deleteBtn.style.display = showDeleteCheckbox.checked ? '' : 'none';
                    }
                }
            });
        }

        saveFormFieldVisibility(typeId, visibility) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            document.cookie = `${ cookieName }=${ JSON.stringify(visibility) }; path=/; max-age=31536000`;
        }

        loadFormFieldVisibility(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            const cookies = document.cookie.split(';');
            const fieldsCookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));

            if (fieldsCookie) {
                try {
                    const visibility = JSON.parse(fieldsCookie.split('=')[1]);
                    return visibility;
                } catch (error) {
                    console.error('Error parsing form field visibility settings:', error);
                    return {};
                }
            }

            return {}; // Default: all fields visible
        }

        saveFormFieldOrder(typeId, order) {
            const cookieName = `${ this.options.cookiePrefix }-form-order-${ typeId }`;
            document.cookie = `${ cookieName }=${ JSON.stringify(order) }; path=/; max-age=31536000`;
        }

        loadFormFieldOrder(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-order-${ typeId }`;
            const cookies = document.cookie.split(';');
            const cookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));
            if (cookie) {
                try {
                    return JSON.parse(cookie.split('=')[1]);
                } catch (e) {
                    return [];
                }
            }
            return [];
        }

        applyFormFieldSettings(modal, typeId) {
            const visibility = this.loadFormFieldVisibility(typeId);
            const order = this.loadFormFieldOrder(typeId);

            // Apply visibility
            Object.entries(visibility).forEach(([fieldId, isVisible]) => {
                if (!isVisible) {
                    const formGroup = modal.querySelector(`#field-${ fieldId }`)?.closest('.form-group');
                    if (formGroup) {
                        formGroup.style.display = 'none';
                    }
                } else {
                    const formGroup = modal.querySelector(`#field-${ fieldId }`)?.closest('.form-group');
                    if (formGroup) {
                        formGroup.style.display = '';
                    }
                }
            });

            // Apply field order by reordering form-group elements within the form
            if (order.length > 0) {
                const form = modal.querySelector('#edit-form');
                if (form) {
                    const tabContent = form.querySelector('[data-tab-content="attributes"]') || form;
                    const formGroups = Array.from(tabContent.querySelectorAll('.form-group'));

                    // Build a map of fieldId -> form-group element
                    const groupMap = {};
                    formGroups.forEach(group => {
                        // Find the field input inside to get its ID
                        const input = group.querySelector('[id^="field-"]');
                        if (input) {
                            const match = input.id.match(/^field-(.+?)(-search|-picker)?$/);
                            if (match) {
                                groupMap[match[1]] = group;
                            }
                        }
                    });

                    // Ensure the first column (main field) is always at the top
                    const mainGroup = groupMap['main'];
                    const orderedGroups = [];
                    const usedIds = new Set();
                    if (mainGroup) {
                        orderedGroups.push(mainGroup);
                        usedIds.add('main');
                    }

                    // Reorder: append groups in the saved order, then append any remaining
                    order.forEach(fieldId => {
                        if (groupMap[fieldId] && !usedIds.has(fieldId)) {
                            orderedGroups.push(groupMap[fieldId]);
                            usedIds.add(fieldId);
                        }
                    });
                    // Append remaining groups that weren't in the saved order
                    formGroups.forEach(group => {
                        const input = group.querySelector('[id^="field-"]');
                        if (input) {
                            const match = input.id.match(/^field-(.+?)(-search|-picker)?$/);
                            if (match && !usedIds.has(match[1])) {
                                orderedGroups.push(group);
                            }
                        } else if (!orderedGroups.includes(group)) {
                            orderedGroups.push(group);
                        }
                    });

                    // Re-append in order (moves existing DOM nodes)
                    orderedGroups.forEach(group => {
                        tabContent.appendChild(group);
                    });
                }
            }
        }

        async saveRecord(modal, isCreate, recordId, typeId, parentId, columnId = null) {
            const form = modal.querySelector('#edit-form');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const apiBase = this.getApiBase();

            try {
                // Step 1: Handle file deletions first (only for edit mode)
                if (!isCreate) {
                    const fileUploads = modal.querySelectorAll('.form-file-upload');
                    for (const uploadContainer of fileUploads) {
                        const reqId = uploadContainer.dataset.reqId;
                        const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);
                        const originalValue = uploadContainer.dataset.originalValue || '';

                        // Check if file was deleted
                        if (hiddenInput.dataset.fileDeleted === 'true' && originalValue) {
                            // Send deletion command: _m_set/{recordId}?JSON&t{reqId}=
                            const deleteParams = new URLSearchParams();
                            if (typeof xsrf !== 'undefined') {
                                deleteParams.append('_xsrf', xsrf);
                            }
                            deleteParams.append(`t${ reqId }`, '');

                            const deleteUrl = `${ apiBase }/_m_set/${ recordId }?JSON`;
                            const deleteResponse = await fetch(deleteUrl, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                body: deleteParams.toString()
                            });

                            if (!deleteResponse.ok) {
                                throw new Error(`Ошибка удаления файла: ${ deleteResponse.statusText }`);
                            }
                        }
                    }
                }

                // Step 2: Prepare form data for save
                const fileUploads = modal.querySelectorAll('.form-file-upload');
                let hasNewFiles = false;

                // Check if there are new files to upload
                for (const uploadContainer of fileUploads) {
                    const reqId = uploadContainer.dataset.reqId;
                    const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);
                    if (hiddenInput.dataset.hasNewFile === 'true' && uploadContainer._fileToUpload) {
                        hasNewFiles = true;
                        break;
                    }
                }

                // Use FormData if there are file uploads, URLSearchParams otherwise
                let requestBody;
                let headers = {};

                if (hasNewFiles) {
                    // Use FormData for file uploads
                    const formData = new FormData(form);
                    requestBody = new FormData();

                    // Add XSRF token
                    if (typeof xsrf !== 'undefined') {
                        requestBody.append('_xsrf', xsrf);
                    }

                    // Get main value
                    const mainValue = formData.get('main');

                    // Add main value as t{typeId}
                    if (isCreate) {
                        if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                            requestBody.append(`t${ typeId }`, mainValue);
                        }
                    } else {
                        requestBody.append(`t${ typeId }`, mainValue);
                    }

                    // Add all form fields
                    for (const [key, value] of formData.entries()) {
                        if (key === 'main') continue;

                        // Check if this is a file field
                        const fieldMatch = key.match(/^t(\d+)$/);
                        if (fieldMatch) {
                            const reqId = fieldMatch[1];
                            const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${ reqId }"]`);

                            if (uploadContainer) {
                                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                                // If there's a new file to upload
                                if (hiddenInput.dataset.hasNewFile === 'true' && uploadContainer._fileToUpload) {
                                    requestBody.append(key, uploadContainer._fileToUpload);
                                    continue;
                                }

                                // If file was deleted, skip it (already handled above)
                                if (hiddenInput.dataset.fileDeleted === 'true') {
                                    continue;
                                }

                                // If it's an existing file, don't include it in the save
                                const originalValue = uploadContainer.dataset.originalValue || '';
                                if (originalValue && hiddenInput.dataset.hasNewFile !== 'true') {
                                    continue;
                                }
                            }
                        }

                        // Add non-file fields
                        if (isCreate) {
                            if (value !== '' && value !== null && value !== undefined) {
                                requestBody.append(key, value);
                            }
                        } else {
                            requestBody.append(key, value);
                        }
                    }
                } else {
                    // Use URLSearchParams for non-file submissions
                    const formData = new FormData(form);
                    const params = new URLSearchParams();

                    // Add XSRF token
                    if (typeof xsrf !== 'undefined') {
                        params.append('_xsrf', xsrf);
                    }

                    // Get main value
                    const mainValue = formData.get('main');

                    // Add all form fields (skip 'main' since it's handled separately as t{typeId})
                    for (const [key, value] of formData.entries()) {
                        if (key === 'main') continue;

                        // Skip file fields that haven't changed
                        const fieldMatch = key.match(/^t(\d+)$/);
                        if (fieldMatch) {
                            const reqId = fieldMatch[1];
                            const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${ reqId }"]`);

                            if (uploadContainer) {
                                const originalValue = uploadContainer.dataset.originalValue || '';
                                const hiddenInput = uploadContainer.querySelector(`#field-${ reqId }`);

                                // Skip existing files and deleted files
                                if ((originalValue && hiddenInput.dataset.hasNewFile !== 'true') || hiddenInput.dataset.fileDeleted === 'true') {
                                    continue;
                                }
                            }
                        }

                        if (isCreate) {
                            if (value !== '' && value !== null && value !== undefined) {
                                params.append(key, value);
                            }
                        } else {
                            params.append(key, value);
                        }
                    }

                    if (isCreate) {
                        if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                            params.append(`t${ typeId }`, mainValue);
                        }
                    } else {
                        params.append(`t${ typeId }`, mainValue);
                    }

                    requestBody = params.toString();
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }

                // Step 3: Save the record
                let url;
                if (isCreate) {
                    url = `${ apiBase }/_m_new/${ typeId }?JSON&up=${ parentId || 1 }`;
                } else {
                    url = `${ apiBase }/_m_save/${ recordId }?JSON`;
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: requestBody
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

                // Check for warning - show modal and stay in edit mode
                // Pass result.obj to show a link to the existing/found record if available
                if (result.warning) {
                    this.showWarningModal(result.warning, result.obj || null);
                    return;
                }

                // Close modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                // Show success message
                this.showToast('Запись успешно сохранена', 'success');

                // Dispatch event for external listeners
                const savedId = isCreate ? (result.id || result.i || null) : recordId;
                document.dispatchEvent(new CustomEvent('integram-record-saved', {
                    detail: { isCreate, recordId: savedId, typeId, result }
                }));

                // Check if we edited a record from a subordinate table
                let refreshedSubordinateTable = false;
                if (!isCreate && this.currentEditModal && this.currentEditModal.subordinateTables) {
                    // Find which subordinate table this record belongs to (by matching typeId with arr_id)
                    const subordinateTable = this.currentEditModal.subordinateTables.find(st => st.arr_id === typeId);

                    if (subordinateTable) {
                        // Reload the specific subordinate table
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ subordinateTable.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, subordinateTable.arr_id, this.currentEditModal.recordId);
                            tabContent.dataset.loaded = 'true';
                            refreshedSubordinateTable = true;
                        }
                    }
                }

                // Check if we edited a record from a cell-opened subordinate table
                if (!refreshedSubordinateTable && this.cellSubordinateContext && this.cellSubordinateContext.arrId === typeId) {
                    await this.loadSubordinateTable(this.cellSubordinateContext.container, this.cellSubordinateContext.arrId, this.cellSubordinateContext.parentRecordId);
                    refreshedSubordinateTable = true;
                }

                // If we didn't refresh a subordinate table, handle normal table refresh
                if (!refreshedSubordinateTable) {
                    // Handle special refresh for column header create
                    if (isCreate && columnId) {
                        // Extract created record ID from response
                        const createdId = result.id || result.i;

                        if (createdId) {
                            await this.refreshWithNewRecord(columnId, createdId);
                        } else {
                            // Fallback to full reload if no ID returned
                            this.data = [];
                            this.loadedRecords = 0;
                            this.hasMore = true;
                            this.totalRows = null;
                            await this.loadData(false);
                        }
                    } else {
                        // Normal reload for edit or regular create
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        await this.loadData(false);
                    }
                }

            } catch (error) {
                console.error('Error saving record:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
            }
        }

        async deleteRecord(modal, recordId, typeId) {
            if (!confirm('Вы уверены, что хотите удалить эту запись?')) {
                return;
            }

            const apiBase = this.getApiBase();

            try {
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                const response = await fetch(`${ apiBase }/_m_del/${ recordId }?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                if (!response.ok) {
                    throw new Error(`Ошибка удаления: ${ response.statusText }`);
                }

                // Close modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                this.showToast('Запись удалена', 'success');

                // Reload table data
                this.data = [];
                this.loadedRecords = 0;
                this.hasMore = true;
                this.totalRows = null;
                await this.loadData(false);
            } catch (error) {
                console.error('Error deleting record:', error);
                this.showToast(`Ошибка удаления: ${ error.message }`, 'error');
            }
        }

        saveFormShowDelete(typeId, show) {
            const cookieName = `${ this.options.cookiePrefix }-form-show-delete-${ typeId }`;
            document.cookie = `${ cookieName }=${ show ? '1' : '0' }; path=/; max-age=31536000`;
        }

        loadFormShowDelete(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-show-delete-${ typeId }`;
            const cookies = document.cookie.split(';');
            const cookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));
            if (cookie) {
                return cookie.split('=')[1].trim() === '1';
            }
            return false; // Hidden by default
        }

        async refreshWithNewRecord(columnId, createdRecordId) {
            try {
                // Fetch the new record using filter
                const params = new URLSearchParams({
                    LIMIT: '0,1',
                    [`FR_${ columnId }`]: createdRecordId
                });

                // Forward GET parameters from page URL (issue #476)
                this.appendPageUrlParams(params);

                const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
                const json = await response.json();

                let newRow = null;

                // Check if response is JSON_OBJ array format
                if (this.isJsonDataArrayFormat(json)) {
                    newRow = json[0].r || [];
                } else {
                    // Transform column-based data to row-based data
                    const columnData = json.data || [];

                    if (columnData.length > 0 && Array.isArray(columnData[0]) && columnData[0].length > 0) {
                        // Extract the first (and only) row
                        const row = [];
                        for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                            row.push(columnData[colIndex][0]);
                        }
                        newRow = row;
                    }
                }

                if (newRow) {
                    // Add the new record to the beginning of the data
                    this.data.unshift(newRow);
                    this.loadedRecords++;

                    // Update total count if known
                    if (this.totalRows !== null) {
                        this.totalRows++;
                    }

                    // Re-render the table
                    this.render();
                } else {
                    // Fallback: full reload if we couldn't fetch the new record
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    await this.loadData(false);
                }
            } catch (error) {
                console.error('Error fetching new record:', error);
                // Fallback to full reload on error
                this.data = [];
                this.loadedRecords = 0;
                this.hasMore = true;
                this.totalRows = null;
                await this.loadData(false);
            }
        }

        roundToNearest5Minutes(date) {
            // Round date to nearest 5 minutes
            const minutes = date.getMinutes();
            const roundedMinutes = Math.round(minutes / 5) * 5;
            date.setMinutes(roundedMinutes);
            date.setSeconds(0);
            date.setMilliseconds(0);
            return date;
        }

        formatDateForInput(value, includeTime = false) {
            // Convert date from various formats to DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try YYYYMMDD format
            if (!date || isNaN(date.getTime())) {
                date = this.parseYYYYMMDD(value);
            }

            // If still failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return value;  // Return as-is if not a valid date
            }

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            }

            return `${ day }.${ month }.${ year }`;
        }

        formatDateForHtml5(value, includeTime = false) {
            // Convert date to HTML5 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try YYYYMMDD format
            if (!date || isNaN(date.getTime())) {
                date = this.parseYYYYMMDD(value);
            }

            // If still failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return '';
            }

            // Round to 5 minutes if time is included
            if (includeTime) {
                date = this.roundToNearest5Minutes(date);
            }

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${ year }-${ month }-${ day }T${ hours }:${ minutes }`;
            }

            return `${ year }-${ month }-${ day }`;
        }

        convertHtml5DateToDisplay(html5Value, includeTime = false) {
            // Convert HTML5 date format to display format
            if (!html5Value) return '';

            if (includeTime) {
                // YYYY-MM-DDTHH:MM(:SS) -> DD.MM.YYYY HH:MM:SS
                const [datePart, timePart] = html5Value.split('T');
                const [year, month, day] = datePart.split('-');
                // Ensure we have seconds (add :00 if not present)
                const timeParts = timePart.split(':');
                const hours = timeParts[0] || '00';
                const minutes = timeParts[1] || '00';
                const seconds = timeParts[2] || '00';
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            } else {
                // YYYY-MM-DD -> DD.MM.YYYY
                const [year, month, day] = html5Value.split('-');
                return `${ day }.${ month }.${ year }`;
            }
        }

        attachFileUploadHandlers(editor, currentValue) {
            const fileInput = editor.querySelector('.file-input');
            const dropzone = editor.querySelector('.file-dropzone');
            const selectBtn = editor.querySelector('.file-select-btn');
            const preview = editor.querySelector('.file-preview');
            const fileName = editor.querySelector('.file-name');
            const removeBtn = editor.querySelector('.file-remove-btn');

            let selectedFile = null;

            // Show current file if exists
            if (currentValue && currentValue !== '') {
                fileName.textContent = currentValue.split('/').pop() || currentValue;
                dropzone.style.display = 'none';
                preview.style.display = 'flex';
                editor.dataset.fileValue = currentValue;
            }

            // Click to select file
            selectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                fileInput.click();
            });

            // Dropzone click
            dropzone.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });

            // File input change
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    await this.handleFileSelection(file, editor, dropzone, preview, fileName);
                }
                // Reset file input so selecting the same file again triggers change
                fileInput.value = '';
            });

            // Drag and drop handlers
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over');
            });

            dropzone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
            });

            dropzone.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');

                const file = e.dataTransfer.files[0];
                if (file) {
                    await this.handleFileSelection(file, editor, dropzone, preview, fileName);
                }
            });

            // Remove file button
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                selectedFile = null;
                editor.dataset.fileValue = '';
                fileName.textContent = '';
                dropzone.style.display = 'flex';
                preview.style.display = 'none';
                fileInput.value = '';
            });
        }

        async handleFileSelection(file, editor, dropzone, preview, fileName) {
            // Show loading state
            const dropzoneText = dropzone.querySelector('.file-dropzone-text');
            const originalText = dropzoneText.textContent;
            dropzoneText.textContent = 'Загрузка...';

            try {
                // Upload file to server
                const uploadedPath = await this.uploadFile(file);

                // Update UI
                fileName.textContent = file.name;
                dropzone.style.display = 'none';
                preview.style.display = 'flex';
                editor.dataset.fileValue = uploadedPath;
            } catch (error) {
                console.error('Error uploading file:', error);
                this.showToast(`Ошибка загрузки файла: ${ error.message }`, 'error');
                dropzoneText.textContent = originalText;
            }
        }

        async uploadFile(file) {
            const apiBase = this.getApiBase();
            const formData = new FormData();
            formData.append('file', file);

            // Add XSRF token
            if (typeof xsrf !== 'undefined') {
                formData.append('_xsrf', xsrf);
            }

            const response = await fetch(`${ apiBase }/_upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${ response.statusText }`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // Return the file path from server response
            return result.path || result.file || result.filename;
        }

        escapeHtml(text) {
            if (text === null || text === undefined) return '';
            return String(text).replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;')
                              .replace(/'/g, '&#039;');
        }

        /**
         * Parse reference field value in "id:Value" format and return display value
         * For reference fields, values come as "id:DisplayText" where id is the record ID
         * This method extracts and returns only the DisplayText part for display/comparison
         * Issue #504: Handle reference values in grouping fields
         *
         * @param {string} value - The raw value, possibly in "id:Value" format
         * @param {Object} column - The column definition object
         * @returns {string} - The display value (without id: prefix for reference fields)
         */
        parseReferenceDisplayValue(value, column) {
            if (value === null || value === undefined) return '';

            const strValue = String(value);

            // Check if this is a reference field (has ref_id or non-zero ref)
            const isRefField = column && (column.ref_id != null || (column.ref && column.ref !== 0));

            if (isRefField && strValue) {
                const colonIndex = strValue.indexOf(':');
                if (colonIndex > 0) {
                    // Return only the display value part (after the colon)
                    return strValue.substring(colonIndex + 1);
                }
            }

            return strValue;
        }

        showToast(message, type = 'info') {
            // Remove existing toasts
            const existingToasts = document.querySelectorAll('.integram-toast');
            existingToasts.forEach(toast => toast.remove());

            const toast = document.createElement('div');
            toast.className = `integram-toast integram-toast-${ type }`;
            toast.textContent = message;

            document.body.appendChild(toast);

            // Auto-remove after 5 seconds
            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            }, 5000);

            // Click to dismiss
            toast.addEventListener('click', () => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            });
        }

        /**
         * Copy record ID to clipboard (issue #563)
         * @param {string} recordId - The record ID to copy
         */
        copyRecordIdToClipboard(recordId) {
            if (!recordId) return;

            navigator.clipboard.writeText(String(recordId)).then(() => {
                this.showToast(`ID #${recordId} скопирован`, 'success');
            }).catch(err => {
                console.error('Failed to copy record ID:', err);
                this.showToast('Не удалось скопировать ID', 'error');
            });
        }

        showWarningModal(message, objId = null) {
            const modalId = `warning-modal-${ Date.now() }`;
            const apiBase = this.getApiBase();

            // Build link HTML if objId is provided
            let linkHtml = '';
            if (objId) {
                const editUrl = `${ apiBase }/edit_obj/${ objId }`;
                linkHtml = `
                    <a href="${ editUrl }" target="_blank" class="integram-modal-link">
                        Открыть найденную запись ↗
                    </a>
                `;
            }

            const modalHtml = `
                <div class="integram-modal-overlay" id="${ modalId }">
                    <div class="integram-modal" style="max-width: 500px;">
                        <div class="integram-modal-header">
                            <h5>Предупреждение</h5>
                        </div>
                        <div class="integram-modal-body">
                            <div class="alert alert-warning" style="margin: 0;">
                                ${ this.escapeHtml(message) }
                            </div>
                            ${ linkHtml }
                        </div>
                        <div class="integram-modal-footer" style="padding: 15px; text-align: right;">
                            <button type="button" class="btn btn-primary" data-close-warning-modal="true">OK</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            const overlay = document.getElementById(modalId);
            const closeBtn = overlay.querySelector('[data-close-warning-modal="true"]');

            closeBtn.addEventListener('click', () => {
                overlay.remove();
            });

            // Also close on click outside the modal
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            });
        }

        /**
         * Toggle checkbox selection mode
         */
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
                    <button class="btn btn-sm btn-outline-secondary bulk-delete-cancel-btn">Отмена</button>
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
                            <h5>Удаление записей</h5>
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
                errorsDiv.innerHTML = `<div class="alert alert-warning" style="max-height: 200px; overflow-y: auto; font-size: 12px; margin-top: 10px;">
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
         * Toggle export menu visibility
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

                if (this.options.dataSource === 'table' || (this.objectTableId && !this.options.tableTypeId)) {
                    // Load data from table format
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

                    // Issue #378: For reference fields, remove "id:" prefix from "id:Value" format
                    const isRefField = col.ref_id != null || (col.ref && col.ref !== 0);
                    if (isRefField && value && typeof value === 'string') {
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

                    // Issue #378: For reference fields, remove "id:" prefix from "id:Value" format
                    const isRefField = col.ref_id != null || (col.ref && col.ref !== 0);
                    if (isRefField && value && typeof value === 'string') {
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

// Global registry for all IntegramTable instances
if (typeof window !== 'undefined') {
    window._integramTableInstances = window._integramTableInstances || [];
}

/**
 * Global function to reload all IntegramTable instances
 * Reloads all table components with their current filter parameters
 * This function is globally accessible and can be called from anywhere on the page
 *
 * @example
 * // Reload all tables on the page
 * reloadAllIntegramTables();
 */
function reloadAllIntegramTables() {
    if (typeof window !== 'undefined' && window._integramTableInstances) {
        window._integramTableInstances.forEach(instance => {
            if (instance && typeof instance.reload === 'function') {
                instance.reload();
            }
        });
    }
}

// Make the function globally accessible
if (typeof window !== 'undefined') {
    window.reloadAllIntegramTables = reloadAllIntegramTables;
}

/**
 * Global function to open a record creation form from anywhere on the page.
 * This function can be called independently of any IntegramTable instance.
 *
 * @param {number|string} tableTypeId - Required. ID of the table in which to create the record.
 * @param {number|string} parentId - Required. Parent ID to pass in the "up" parameter when creating the record.
 * @param {Object} [fieldValues={}] - Optional. Object with field values to pre-fill on the form.
 *                                    Keys should be in format "t{fieldId}", e.g. {'t3888': 357, 't3886': 'Отказались'}.
 *
 * @example
 * // Open form to create a record in table 3596 with parent 1
 * openCreateRecordForm(3596, 1);
 *
 * @example
 * // Open form with pre-filled field values
 * openCreateRecordForm(3596, 1, {'t3888': 357, 't3886': 'Отказались'});
 */
async function openCreateRecordForm(tableTypeId, parentId, fieldValues = {}) {
    if (!tableTypeId) {
        console.error('openCreateRecordForm: tableTypeId is required');
        return;
    }
    if (!parentId && parentId !== 0) {
        console.error('openCreateRecordForm: parentId is required');
        return;
    }

    try {
        // Determine API base from current page URL
        const pathParts = window.location.pathname.split('/');
        let apiBase = '';
        if (pathParts.length >= 2 && pathParts[1]) {
            apiBase = window.location.origin + '/' + pathParts[1];
        }

        if (!apiBase) {
            console.error('openCreateRecordForm: Could not determine API base URL');
            return;
        }

        // Fetch metadata for the table type
        const metadataUrl = `${apiBase}/metadata/${tableTypeId}`;
        const metadataResponse = await fetch(metadataUrl);

        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch metadata: ${metadataResponse.statusText}`);
        }

        const metadata = await metadataResponse.json();

        // Convert fieldValues to recordData format for pre-filling
        // Input: {'t3888': 357, 't3886': 'Отказались'}
        // Output: {obj: {val: ''}, reqs: {3888: {value: 357}, 3886: {value: 'Отказались'}}}
        const recordData = {
            obj: { val: '', parent: parentId },
            reqs: {}
        };

        // Check if main field (t{tableTypeId}) is in fieldValues
        const mainFieldKey = `t${tableTypeId}`;
        if (fieldValues[mainFieldKey] !== undefined) {
            recordData.obj.val = fieldValues[mainFieldKey];
        }

        // Process other field values
        for (const [key, value] of Object.entries(fieldValues)) {
            // Match t{fieldId} format
            const match = key.match(/^t(\d+)$/);
            if (match) {
                const fieldId = match[1];
                // Skip main field as it's handled separately
                if (fieldId !== String(tableTypeId)) {
                    recordData.reqs[fieldId] = { value: value };
                }
            }
        }

        // Fetch parent info if parentId is not 1 (root)
        let parentInfo = null;
        if (String(parentId) !== '1') {
            try {
                const parentUrl = `${apiBase}/edit_obj/${parentId}?JSON`;
                const parentResponse = await fetch(parentUrl);
                if (parentResponse.ok) {
                    const parentData = await parentResponse.json();
                    if (parentData && parentData.obj && parentData.obj.val) {
                        parentInfo = {
                            id: parentData.obj.id,
                            val: parentData.obj.val,
                            typ_name: parentData.obj.typ_name
                        };
                    }
                }
            } catch (parentError) {
                // Silently fail - parent info is optional, form should still work
                console.warn('openCreateRecordForm: Could not fetch parent info:', parentError);
            }
        }

        // Create the modal using a minimal helper class instance
        // This reuses the existing form rendering logic from IntegramTable
        const helper = new IntegramCreateFormHelper(apiBase, tableTypeId, parentId);
        helper.renderCreateFormModal(metadata, recordData, fieldValues, parentInfo);

    } catch (error) {
        console.error('openCreateRecordForm: Error opening form:', error);
        // Show error toast if available
        if (typeof showToast === 'function') {
            showToast(`Ошибка: ${error.message}`, 'error');
        } else {
            alert(`Ошибка: ${error.message}`);
        }
    }
}

/**
 * Helper class for rendering create form modals independently of IntegramTable instances.
 * This allows openCreateRecordForm to work without requiring an existing table on the page.
 */
class IntegramCreateFormHelper {
    constructor(apiBase, tableTypeId, parentId) {
        this.apiBase = apiBase;
        this.tableTypeId = tableTypeId;
        this.parentId = parentId;
        this.metadataCache = {};
    }

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    getMetadataName(metadata) {
        return metadata.val || metadata.name || metadata.title || `Тип #${metadata.id || '?'}`;
    }

    parseAttrs(attrs) {
        const result = {
            required: false,
            multi: false,
            alias: null
        };

        if (!attrs) return result;

        result.required = attrs.includes(':!NULL:');
        result.multi = attrs.includes(':MULTI:');

        const aliasMatch = attrs.match(/:ALIAS=(.*?):/);
        if (aliasMatch) {
            result.alias = aliasMatch[1];
        }

        return result;
    }

    normalizeFormat(baseTypeId) {
        const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                              'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                              'GRANT', 'REPORT_COLUMN', 'PATH'];

        const upperTypeId = String(baseTypeId).toUpperCase();

        if (validFormats.includes(upperTypeId)) {
            return upperTypeId;
        }

        // Map numeric type IDs to format names
        const formatMap = {
            '3': 'SHORT',
            '8': 'CHARS',
            '9': 'DATE',
            '13': 'NUMBER',
            '14': 'SIGNED',
            '11': 'BOOLEAN',
            '12': 'MEMO',
            '4': 'DATETIME',
            '10': 'FILE',
            '2': 'HTML',
            '7': 'BUTTON',
            '6': 'PWD',
            '5': 'GRANT',
            '16': 'REPORT_COLUMN',
            '17': 'PATH'
        };
        return formatMap[String(baseTypeId)] || 'SHORT';
    }

    formatDateForHtml5(dateStr, includeTime = false) {
        if (!dateStr) return '';

        // Handle DD.MM.YYYY format
        const dateParts = dateStr.split(' ')[0].split('.');
        if (dateParts.length === 3) {
            const [day, month, year] = dateParts;
            if (includeTime) {
                const timeParts = dateStr.split(' ')[1] || '00:00';
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeParts}`;
            }
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        return dateStr;
    }

    formatDateForInput(dateStr, includeTime = false) {
        if (!dateStr) return '';
        return dateStr;
    }

    showToast(message, type = 'info') {
        // Try to use existing toast function if available
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Create a simple toast notification
        const toast = document.createElement('div');
        toast.className = `integram-toast integram-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 4px;
            color: white;
            z-index: 10000;
            font-family: sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            background-color: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    renderCreateFormModal(metadata, recordData, fieldValues, parentInfo = null) {
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

        // Add cascade offset for nested modals (6px per level)
        const cascadeOffset = (modalDepth - 1) * 6;
        modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

        // Store reference to overlay on modal for proper cleanup
        modal._overlayElement = overlay;

        const typeName = this.getMetadataName(metadata);
        const title = `Создание: ${typeName}`;

        // Build parent info subtitle HTML if parentInfo is provided
        let parentSubtitleHtml = '';
        if (parentInfo && parentInfo.val) {
            const escapedParentVal = this.escapeHtml(parentInfo.val);
            parentSubtitleHtml = `<div class="edit-form-parent-subtitle">в: ${escapedParentVal}</div>`;
        }

        // Render the form
        const reqs = metadata.reqs || [];
        const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};
        const regularFields = reqs.filter(req => !req.arr_id);

        // Build attributes form HTML
        let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, fieldValues);

        let formHtml = `
            <div class="edit-form-header">
                <div class="edit-form-header-titles">
                    <h5>${title}</h5>
                    ${parentSubtitleHtml}
                </div>
                <button class="edit-form-close" data-close-modal="true">×</button>
            </div>
            <div class="edit-form-body">
                <div class="edit-form-tab-content active" data-tab-content="attributes">
                    <form id="edit-form" class="edit-form">
                        ${attributesHtml}
                    </form>
                </div>
            </div>
            <div class="edit-form-footer">
                <div class="edit-form-footer-buttons">
                    <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                    <button type="button" class="btn btn-secondary" data-close-modal="true">Отмена</button>
                </div>
            </div>
        `;

        modal.innerHTML = formHtml;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Load reference options for dropdowns
        this.loadReferenceOptions(metadata.reqs, modal, fieldValues);

        // Attach date/datetime picker handlers
        this.attachDatePickerHandlers(modal);

        // Attach file upload handlers
        this.attachFormFileUploadHandlers(modal);

        // Attach save handler
        const saveBtn = modal.querySelector('#save-record-btn');
        saveBtn.addEventListener('click', () => {
            this.saveRecord(modal, metadata);
        });

        // Close modal helper function
        const closeModal = () => {
            modal.remove();
            overlay.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
        };

        // Attach close handlers to buttons with data-close-modal attribute
        modal.querySelectorAll('[data-close-modal="true"]').forEach(btn => {
            btn.addEventListener('click', closeModal);
        });

        overlay.addEventListener('click', closeModal);
    }

    renderAttributesForm(metadata, recordData, regularFields, recordReqs, fieldValues) {
        let html = '';

        // Get current date/datetime for default values (since this is create mode)
        const now = new Date();
        const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
        now.setMinutes(minutes);
        const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
        const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
        const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

        // Main value field - render according to base type
        const typeName = this.getMetadataName(metadata);
        const mainValue = recordData && recordData.obj ? recordData.obj.val || '' : '';
        const mainFieldType = this.normalizeFormat(metadata.type);

        // Build main field HTML based on its type
        let mainFieldHtml = '';
        if (mainFieldType === 'BOOLEAN') {
            const isChecked = mainValue ? 'checked' : '';
            mainFieldHtml = `<input type="checkbox" id="field-main" name="main" value="1" ${ isChecked }>`;
        } else if (mainFieldType === 'DATE') {
            const dateValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, false) : currentDateHtml5;
            const dateValueDisplay = mainValue ? this.formatDateForInput(mainValue, false) : currentDateDisplay;
            mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateValueHtml5) }">`;
            mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
        } else if (mainFieldType === 'DATETIME') {
            const dateTimeValueHtml5 = mainValue ? this.formatDateForHtml5(mainValue, true) : currentDateTimeHtml5;
            const dateTimeValueDisplay = mainValue ? this.formatDateForInput(mainValue, true) : currentDateTimeDisplay;
            mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-picker" required data-target="field-main" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
            mainFieldHtml += `<input type="hidden" id="field-main" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
        } else if (mainFieldType === 'NUMBER') {
            mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
        } else if (mainFieldType === 'SIGNED') {
            mainFieldHtml = `<input type="number" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required step="0.01">`;
        } else if (mainFieldType === 'MEMO') {
            mainFieldHtml = `<textarea class="form-control memo-field" id="field-main" name="main" rows="4" required>${ this.escapeHtml(mainValue) }</textarea>`;
        } else {
            // Default: text input (SHORT, CHARS, etc.)
            mainFieldHtml = `<input type="text" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>`;
        }

        html += `
            <div class="form-group">
                <label for="field-main">${typeName} <span class="required">*</span></label>
                ${ mainFieldHtml }
            </div>
        `;

        // Render requisite fields
        regularFields.forEach(req => {
            const attrs = this.parseAttrs(req.attrs);
            const fieldName = attrs.alias || req.val;
            const reqValue = recordReqs[req.id] ? recordReqs[req.id].value || '' : '';
            const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base || req.type : req.type;
            const baseFormat = this.normalizeFormat(baseTypeId);
            const isRequired = attrs.required;

            html += `<div class="form-group">`;
            html += `<label for="field-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

            // Reference field (searchable dropdown)
            if (req.ref_id) {
                const currentValue = reqValue || '';
                html += `
                    <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                        <div class="inline-editor-reference form-ref-editor-box">
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search form-ref-search"
                                       id="field-${req.id}-search"
                                       placeholder="Поиск..."
                                       autocomplete="off">
                                <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                            </div>
                            <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${req.id}-dropdown">
                                <div class="inline-editor-reference-empty">Загрузка...</div>
                            </div>
                        </div>
                        <input type="hidden"
                               class="form-ref-value"
                               id="field-${req.id}"
                               name="t${req.id}"
                               value="${this.escapeHtml(currentValue)}"
                               data-ref-id="${req.id}">
                    </div>
                `;
            }
            // Boolean field
            else if (baseFormat === 'BOOLEAN') {
                const isChecked = reqValue ? 'checked' : '';
                html += `<input type="checkbox" id="field-${req.id}" name="t${req.id}" value="1" ${isChecked}>`;
            }
            // Date field
            else if (baseFormat === 'DATE') {
                const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : '';
                const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : '';
                html += `<input type="date" class="form-control date-picker" id="field-${req.id}-picker" value="${this.escapeHtml(dateValueHtml5)}" ${isRequired ? 'required' : ''} data-target="field-${req.id}">`;
                html += `<input type="hidden" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(dateValueDisplay)}">`;
            }
            // DateTime field
            else if (baseFormat === 'DATETIME') {
                const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : '';
                const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : '';
                html += `<input type="datetime-local" class="form-control datetime-picker" id="field-${req.id}-picker" value="${this.escapeHtml(dateTimeValueHtml5)}" ${isRequired ? 'required' : ''} data-target="field-${req.id}">`;
                html += `<input type="hidden" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(dateTimeValueDisplay)}">`;
            }
            // MEMO field (multi-line text)
            else if (baseFormat === 'MEMO') {
                html += `<textarea class="form-control memo-field" id="field-${req.id}" name="t${req.id}" rows="4" ${isRequired ? 'required' : ''}>${this.escapeHtml(reqValue)}</textarea>`;
            }
            // FILE field
            else if (baseFormat === 'FILE') {
                html += `
                    <div class="form-file-upload" data-req-id="${req.id}" data-original-value="">
                        <input type="file" class="file-input" id="field-${req.id}-file" style="display: none;">
                        <div class="file-dropzone">
                            <span class="file-dropzone-text">Перетащите файл сюда или нажмите для выбора</span>
                            <button type="button" class="file-select-btn">Выбрать файл</button>
                        </div>
                        <div class="file-preview" style="display: none;">
                            <span class="file-name"></span>
                            <button type="button" class="file-remove-btn" title="Удалить файл">×</button>
                        </div>
                        <input type="hidden" id="field-${req.id}" name="t${req.id}" value="" ${isRequired ? 'required' : ''} data-file-deleted="false">
                    </div>
                `;
            }
            // Regular text field
            else {
                html += `<input type="text" class="form-control" id="field-${req.id}" name="t${req.id}" value="${this.escapeHtml(reqValue)}" ${isRequired ? 'required' : ''}>`;
            }

            html += `</div>`;
        });

        return html;
    }

    async loadReferenceOptions(reqs, modal, fieldValues) {
        if (!reqs) return;

        for (const req of reqs) {
            if (!req.ref_id) continue;

            const dropdown = modal.querySelector(`#field-${req.id}-dropdown`);
            const hiddenInput = modal.querySelector(`#field-${req.id}`);
            const searchInput = modal.querySelector(`#field-${req.id}-search`);

            if (!dropdown || !hiddenInput) continue;

            try {
                const url = `${this.apiBase}/_ref_reqs/${req.id}?JSON&LIMIT=50`;
                const response = await fetch(url);
                const data = await response.json();

                // Parse options - data is an object {id: text, ...}
                let optionsHtml = '';
                const entries = Object.entries(data);

                if (entries.length === 0) {
                    optionsHtml = '<div class="inline-editor-reference-empty">Нет данных</div>';
                } else {
                    entries.forEach(([id, text]) => {
                        optionsHtml += `<div class="inline-editor-reference-option" data-value="${this.escapeHtml(id)}">${this.escapeHtml(text)}</div>`;
                    });
                }

                dropdown.innerHTML = optionsHtml;

                // Check if this field has a pre-filled value from fieldValues
                const fieldKey = `t${req.id}`;
                const prefilledValue = fieldValues[fieldKey];

                if (prefilledValue !== undefined) {
                    hiddenInput.value = prefilledValue;
                    // Find and display the text for this value
                    const text = data[prefilledValue];
                    if (text && searchInput) {
                        searchInput.value = text;
                    }
                }

                // Attach click handlers for options
                dropdown.querySelectorAll('.inline-editor-reference-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const value = option.dataset.value;
                        const text = option.textContent;
                        hiddenInput.value = value;
                        if (searchInput) {
                            searchInput.value = text;
                        }
                        dropdown.style.display = 'none';
                    });
                });

                // Attach search handler
                if (searchInput) {
                    searchInput.addEventListener('focus', () => {
                        dropdown.style.display = 'block';
                    });

                    searchInput.addEventListener('input', () => {
                        const query = searchInput.value.toLowerCase();
                        dropdown.querySelectorAll('.inline-editor-reference-option').forEach(option => {
                            const text = option.textContent.toLowerCase();
                            option.style.display = text.includes(query) ? '' : 'none';
                        });
                    });
                }

                // Attach clear button handler
                const clearBtn = modal.querySelector(`#field-${req.id}-search`)?.closest('.inline-editor-reference-header')?.querySelector('.form-ref-clear');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        hiddenInput.value = '';
                        if (searchInput) {
                            searchInput.value = '';
                        }
                    });
                }

            } catch (error) {
                console.error(`Error loading reference options for field ${req.id}:`, error);
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
            }
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.form-reference-editor')) {
                modal.querySelectorAll('.form-ref-dropdown').forEach(dropdown => {
                    dropdown.style.display = 'none';
                });
            }
        });
    }

    attachDatePickerHandlers(modal) {
        // Handle date pickers
        modal.querySelectorAll('.date-picker').forEach(picker => {
            picker.addEventListener('change', () => {
                const targetId = picker.dataset.target;
                const hiddenInput = modal.querySelector(`#${targetId}`);
                if (hiddenInput && picker.value) {
                    // Convert YYYY-MM-DD to DD.MM.YYYY
                    const [year, month, day] = picker.value.split('-');
                    hiddenInput.value = `${day}.${month}.${year}`;
                } else if (hiddenInput) {
                    hiddenInput.value = '';
                }
            });
        });

        // Handle datetime pickers
        modal.querySelectorAll('.datetime-picker').forEach(picker => {
            picker.addEventListener('change', () => {
                const targetId = picker.dataset.target;
                const hiddenInput = modal.querySelector(`#${targetId}`);
                if (hiddenInput && picker.value) {
                    // Convert YYYY-MM-DDTHH:MM to DD.MM.YYYY HH:MM
                    const [datePart, timePart] = picker.value.split('T');
                    const [year, month, day] = datePart.split('-');
                    hiddenInput.value = `${day}.${month}.${year} ${timePart}`;
                } else if (hiddenInput) {
                    hiddenInput.value = '';
                }
            });
        });
    }

    attachFormFileUploadHandlers(modal) {
        modal.querySelectorAll('.form-file-upload').forEach(container => {
            const fileInput = container.querySelector('.file-input');
            const dropzone = container.querySelector('.file-dropzone');
            const preview = container.querySelector('.file-preview');
            const fileName = container.querySelector('.file-name');
            const removeBtn = container.querySelector('.file-remove-btn');
            const selectBtn = container.querySelector('.file-select-btn');
            const hiddenInput = container.querySelector('input[type="hidden"]');

            if (selectBtn) {
                selectBtn.addEventListener('click', () => fileInput.click());
            }

            if (dropzone) {
                dropzone.addEventListener('click', () => fileInput.click());

                dropzone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dropzone.classList.add('dragover');
                });

                dropzone.addEventListener('dragleave', () => {
                    dropzone.classList.remove('dragover');
                });

                dropzone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropzone.classList.remove('dragover');
                    if (e.dataTransfer.files.length > 0) {
                        fileInput.files = e.dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change'));
                    }
                });
            }

            if (fileInput) {
                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length > 0) {
                        const file = fileInput.files[0];
                        container._fileToUpload = file;
                        hiddenInput.dataset.hasNewFile = 'true';
                        fileName.textContent = file.name;
                        dropzone.style.display = 'none';
                        preview.style.display = 'flex';
                    }
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    container._fileToUpload = null;
                    hiddenInput.dataset.hasNewFile = 'false';
                    hiddenInput.value = '';
                    fileInput.value = '';
                    fileName.textContent = '';
                    dropzone.style.display = '';
                    preview.style.display = 'none';
                });
            }
        });
    }

    async saveRecord(modal, metadata) {
        const form = modal.querySelector('#edit-form');

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        try {
            // Check for file uploads
            const fileUploads = modal.querySelectorAll('.form-file-upload');
            let hasNewFiles = false;

            for (const uploadContainer of fileUploads) {
                if (uploadContainer._fileToUpload) {
                    hasNewFiles = true;
                    break;
                }
            }

            // Prepare request body
            let requestBody;
            let headers = {};

            const formData = new FormData(form);

            if (hasNewFiles) {
                requestBody = new FormData();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    requestBody.append('_xsrf', xsrf);
                }

                // Get main value
                const mainValue = formData.get('main');
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    requestBody.append(`t${this.tableTypeId}`, mainValue);
                }

                // Add all form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;

                    // Check if this is a file field
                    const fieldMatch = key.match(/^t(\d+)$/);
                    if (fieldMatch) {
                        const reqId = fieldMatch[1];
                        const uploadContainer = modal.querySelector(`.form-file-upload[data-req-id="${reqId}"]`);

                        if (uploadContainer && uploadContainer._fileToUpload) {
                            requestBody.append(key, uploadContainer._fileToUpload);
                            continue;
                        }
                    }

                    if (value !== '' && value !== null && value !== undefined) {
                        requestBody.append(key, value);
                    }
                }
            } else {
                const params = new URLSearchParams();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Get main value
                const mainValue = formData.get('main');

                // Add all form fields
                for (const [key, value] of formData.entries()) {
                    if (key === 'main') continue;
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append(`t${this.tableTypeId}`, mainValue);
                }

                requestBody = params.toString();
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            // Create the record
            const url = `${this.apiBase}/_m_new/${this.tableTypeId}?JSON&up=${this.parentId || 1}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: requestBody
            });

            const text = await response.text();
            let result;

            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid response: ${text}`);
            }

            if (result.error) {
                throw new Error(result.error);
            }

            // Success - close modal
            this.showToast('Запись создана', 'success');

            // Close modal
            modal._overlayElement?.remove();
            modal.remove();
            window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

            // Reload any IntegramTable instances on the page
            if (typeof reloadAllIntegramTables === 'function') {
                reloadAllIntegramTables();
            }

        } catch (error) {
            console.error('Error saving record:', error);
            this.showToast(`Ошибка: ${error.message}`, 'error');
        }
    }
}

// Make openCreateRecordForm globally accessible
if (typeof window !== 'undefined') {
    window.openCreateRecordForm = openCreateRecordForm;
    window.IntegramCreateFormHelper = IntegramCreateFormHelper;
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
            instanceName: element.dataset.instanceName || element.id,
            dataSource: element.dataset.dataSource || 'report',
            tableTypeId: element.dataset.tableTypeId || null,
            parentId: element.dataset.parentId || null
        };

        // Create instance and store in window if instanceName is provided
        const instance = new IntegramTable(element.id, options);
        if (options.instanceName) {
            window[options.instanceName] = instance;
        }

        // Register instance in global registry
        if (typeof window !== 'undefined' && window._integramTableInstances) {
            window._integramTableInstances.push(instance);
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
