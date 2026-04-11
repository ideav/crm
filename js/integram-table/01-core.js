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
            this.tableGranted = null;  // 'WRITE' = full access, other value = read-only (issue #1508)
            this.rawObjectData = [];  // Raw data array with {i, u, o, r} for object format (preserves record IDs)
            this.styleColumns = {};  // Map of column IDs to their style column values
            this.idColumns = new Set();  // Set of hidden ID column IDs
            this.columnWidths = {};  // Map of column IDs to their widths in pixels
            this.metadataCache = {};  // Cache for metadata by type ID
            this.metadataFetchPromises = {};  // In-progress fetch promises by type ID (issue #1455)
            this.grantOptionsCache = null;  // Cache for GRANT dropdown options (issue #607)
            this.reportColumnOptionsCache = null;  // Cache for REPORT_COLUMN dropdown options (issue #607)
            this.refOptionsCache = {};  // Cache for reference field filter dropdown options by column ID (issue #795)
            this.refFetchCache = {};  // Cache for fetchReferenceOptions results by composite key (issue #1571)
            this.editableColumns = new Map();  // Map of column IDs to their corresponding ID column IDs
            this.checkboxMode = false;  // Whether checkbox selection column is visible
            this.selectedRows = new Set();  // Set of selected row indices
            this.globalMetadata = null;  // Global metadata for determining parent relationships
            this.globalMetadataPromise = null;  // Promise for in-progress globalMetadata fetch (issue #789)
            this.currentEditingCell = null;  // Track currently editing cell
            this.pendingCellClick = null;  // Track pending cell click for focus preservation (issue #518)
            this.pendingNewRow = null;  // Track pending new row being created (issue #807)
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
                compactForAll: true,  // true = apply compact setting to all tables without explicit setting (default)
                pageSize: this.options.pageSize,  // Current page size
                truncateLongValues: true,  // true = truncate to 127 chars (default)
                wrapHeaders: false,  // false = nowrap (default), true = wrap column headers
                hideMenuButtonLabels: false,  // false = show labels below toolbar buttons (default)
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
            this.filterTypes['GRANT'] = this.filterTypes['NUMBER'];
            this.filterTypes['REPORT_COLUMN'] = this.filterTypes['NUMBER'];
            // REF format for reference/lookup fields with dropdown filter (issue #795)
            // Values are stored with @-prefix: single = '@id', multi = '@IN(id1,id2)'
            // The format FR_{T}={X} passes the full value as-is to the API parameter
            // Text-based filters (~, ^, !) use displayValue for partial text matching (issue #799)
            this.filterTypes['REF'] = [
                { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                { symbol: '(,)', name: 'в списке', format: 'FR_{ T }={ X }' },
                { symbol: '~', name: 'содержит', format: 'FR_{ T }=%{ X }%' },
                { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                { symbol: '!', name: 'не содержит', format: 'FR_{ T }=!%{ X }%' },
                { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
            ];
            // Text-based filter types for REF columns - these use text input instead of dropdown (issue #799)
            this.refTextFilterTypes = new Set(['~', '^', '!']);

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
                '5': 'GRANT',      // Grant (dropdown select)
                '16': 'REPORT_COLUMN', // Report column (dropdown select)
                '17': 'CHARS'      // Path (treat as string for filters)
            };

            return typeMap[id] || 'SHORT'; // Default to SHORT if not found
        }

        /**
         * Check if the table has WRITE access (issue #1508)
         * Returns true when tableGranted is null (not set) or equals "WRITE"
         * Returns false for any other granted value (e.g. "READ")
         */
        isTableWritable() {
            return this.tableGranted === null || this.tableGranted === 'WRITE';
        }

        /**
         * Check if the user has permission to modify table structure (issue #1536)
         * Returns true when window.grants["1"] equals "WRITE"
         */
        isStructureWritable() {
            return window.grants && window.grants['1'] === 'WRITE';
        }

        /**
         * Check if a type ID is a base (primitive) type (issue #708)
         * Base types (2-17) don't have metadata and cannot be used for edit forms
         * @param {string|number} typeId - Type ID to check
         * @returns {boolean} True if typeId is a base type
         */
        isBaseType(typeId) {
            const id = parseInt(typeId, 10);
            // Base types are IDs 2-17 (primitives like string, number, date, etc.)
            return !isNaN(id) && id >= 2 && id <= 17;
        }

        init() {
            // Remove padding from the parent container so the table fills full width (issue #887)
            if (this.container && this.container.parentElement) {
                this.container.parentElement.parentElement.style.padding = '0';
            }
            this.loadColumnState();
            this.loadSettings();
            this.applyPageFontSize();  // Apply stored font size to the page on load (issue #1626)
            this.loadConfigFromUrl();  // Load filters, groups, sorting from URL (issue #510)
            this.globalMetadataPromise = this.loadGlobalMetadata();  // Store promise so fetchMetadata() can await it (issue #789)
            this.loadParentInfo();  // Load parent info for breadcrumb title (issue #571)
            this.loadData();
        }

        async loadGlobalMetadata() {
            // If already loaded, return immediately (issue #1455)
            if (this.globalMetadata) {
                return;
            }

            // If loading is already in progress, wait for it instead of starting a new fetch (issue #1455)
            if (this.globalMetadataPromise) {
                return this.globalMetadataPromise;
            }

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
         * Load parent info when F_U filter is present and > 1 (issue #571, #1708)
         * Fetches parent record data from get_parent/{parentId}
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
                const response = await fetch(`${ apiBase }/get_parent/${ parentId }`);
                if (!response.ok) {
                    console.error('Failed to fetch parent info:', response.status);
                    return;
                }
                const data = await response.json();
                if (data && data.id) {
                    this.parentInfo = {
                        id: data.id,
                        val: data.val,
                        obj: data.obj,
                        up: data.up,
                        type: data.type
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

            const instanceName = this.options.instanceName;

            // Show create record button next to title when data source is a table and write access is granted (issue #693, #697, #1508)
            const createBtnHtml = this.getDataSourceType() === 'table' && this.isTableWritable()
                ? `<button class="column-add-btn title-create-btn" onclick="window.${ instanceName }.openTitleCreateForm()" title="Создать запись"><i class="pi pi-plus"></i></button>`
                : '';

            // Extract database name from URL path for building links
            const pathParts = window.location.pathname.split('/');
            const dbName = pathParts.length >= 2 ? pathParts[1] : '';

            // If we have parent info, show breadcrumb-style title
            if (this.parentInfo) {
                const parentTypeName = this.escapeHtml(this.parentInfo.type || '');
                const parentVal = this.escapeHtml(this.parentInfo.val || '');
                const parentObjId = this.parentInfo.obj || '';
                const parentUp = parseInt(this.parentInfo.up, 10) || 0;
                const parentRecordId = this.options.parentId || '';
                const currentTitle = this.escapeHtml(this.options.title || '');

                // Build link for parent table name: table/{obj} with ?F_U={up} if up > 1 (issue #1708)
                let parentTypeLink = `/${ dbName }/table/${ parentObjId }`;
                if (parentUp > 1) {
                    parentTypeLink += `?F_U=${ parentUp }`;
                }

                // Build link for record value: table/{F_U value} (issue #1708)
                const parentRecordLink = `/${ dbName }/table/${ parentRecordId }`;

                // Parent table name links to table/{obj}, record value links to table/{F_U value} (issue #1708)
                return `<div class="integram-table-title-area">${ this.renderCheckboxToggleHtml() }<div class="integram-table-title"><a class="integram-title-link integram-parent-type-link" href="${ parentTypeLink }">${ parentTypeName }</a> <a class="integram-title-link integram-parent-record-link" href="${ parentRecordLink }">${ parentVal }</a>${ currentTitle ? ': ' + currentTitle : '' }</div>${ createBtnHtml }</div>`;
            }

            // No parent info, just show the title
            return `<div class="integram-table-title-area">${ this.renderCheckboxToggleHtml() }<div class="integram-table-title">${ this.escapeHtml(this.options.title) }</div>${ createBtnHtml }</div>`;
        }

        /**
         * Render checkbox toggle button for the title area (issue #1006)
         */
        renderCheckboxToggleHtml() {
            const instanceName = this.options.instanceName;
            return `<div class="integram-table-checkbox-toggle${ this.checkboxMode ? ' active' : '' }" onclick="window.${ instanceName }.toggleCheckboxMode()" title="Выбор строк в таблице">
                <i class="pi pi-check-square"></i>
            </div>`;
        }

        /**
         * Open create record form from the title area (issue #693)
         * Used when dataSource='table' to create a new record in the main table type
         */
        async openTitleCreateForm() {
            try {
                const typeId = this.options.tableTypeId || this.objectTableId;
                if (!typeId) {
                    this.showToast('Ошибка: не найден тип таблицы', 'error');
                    return;
                }

                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];

                // Pre-fill reference fields from URL @id filters (issue #553)
                const prefillReqs = this.buildRefIdPrefillFromUrlFilters(metadata);
                // Issue #616: Use F_U from URL as parent when F_U > 1
                const parentForCreate = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
                const createRecordData = prefillReqs ? { obj: { val: '', parent: parentForCreate }, reqs: prefillReqs } : null;

                this.renderEditFormModal(metadata, createRecordData, true, typeId, null);

            } catch (error) {
                console.error('Error opening create form from title:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        async loadData(append = false) {
            // Block concurrent loads; block appending when there are no more records.
            // Allow non-append (refresh) calls unconditionally so the refresh button works (issue #1516).
            if (this.isLoading || (append && !this.hasMore)) {
                return;
            }

            this.isLoading = true;

            try {
                let json;
                let newRows = [];

                if (this.getDataSourceType() === 'table') {
                    // Load data from table format (object/{typeId}/?JSON_OBJ&F_U={parentId}) (issue #697)
                    json = await this.loadDataFromTable(append);
                } else {
                    // Load data from report format (default behavior) (issue #697)
                    json = await this.loadDataFromReport(append);
                    // Auto-set table title from report header if not explicitly provided (issue #537)
                    if (json && !this.options.title && json.header) {
                        this.options.title = json.header;
                    }
                }

                // If server returned null or empty result, treat as empty (issue #1514)
                if (!json) {
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = false;
                    this.totalRows = 0;
                    this.render();
                    return;
                }

                newRows = json.rows || [];
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

                // Issue #614: Add newly created columns to visibleColumns and columnOrder
                // New columns (present in metadata but not in saved state) should appear visible by default
                const savedColumnIdsSet = new Set(this.columnOrder);
                const newColumnIds = this.columns
                    .filter(c => !savedColumnIdsSet.has(c.id) && !this.idColumns.has(c.id))
                    .map(c => c.id);
                // Issue #978: Always remove stale IDs (deleted columns) from columnOrder, regardless of
                // whether new columns were added. Without this, deleted columns' IDs remain in columnOrder
                // and cause wrong order values when sending _d_ord requests.
                this.columnOrder = [...this.columnOrder.filter(id => currentColumnIds.has(id)), ...newColumnIds];
                if (newColumnIds.length > 0) {
                    // Make new columns visible
                    this.visibleColumns = [...this.visibleColumns, ...newColumnIds.filter(id => !this.visibleColumns.includes(id))];
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
            // Auto-detect tableTypeId from URL if not explicitly provided (issue #699)
            if (!this.options.tableTypeId) {
                let typeId = null;

                // Try /object/{id} pattern first
                const objectMatch = this.options.apiUrl && this.options.apiUrl.match(/\/object\/(\d+)/);
                if (objectMatch) {
                    typeId = objectMatch[1];
                }

                // Try /metadata/{id} pattern
                if (!typeId) {
                    const metadataMatch = this.options.apiUrl && this.options.apiUrl.match(/\/metadata\/(\d+)/);
                    if (metadataMatch) {
                        typeId = metadataMatch[1];
                    }
                }

                // Try to get from already stored objectTableId
                if (!typeId && this.objectTableId) {
                    typeId = this.objectTableId;
                }

                // Try to extract from any /{database}/{endpoint}/{id} pattern
                if (!typeId && this.options.apiUrl) {
                    const genericMatch = this.options.apiUrl.match(/\/(\d+)(?:\/|\?|$)/);
                    if (genericMatch) {
                        typeId = genericMatch[1];
                    }
                }

                if (!typeId) {
                    throw new Error(`tableTypeId is required for dataSource=table. Cannot auto-detect from apiUrl: ${this.options.apiUrl}. Expected patterns: /object/{id}, /metadata/{id}, or /{id}`);
                }

                this.options.tableTypeId = typeId;
            }

            this.objectTableId = this.options.tableTypeId;  // Store table ID for _count=1 queries

            // In grouping mode, use LIMIT=1000 and disable scrolling (issue #502)
            const isGroupingMode = this.groupingEnabled && this.groupingColumns.length > 0;
            const requestSize = isGroupingMode ? 1000 : (this.options.pageSize + 1);
            const offset = (append && !isGroupingMode) ? this.loadedRecords : 0;

            // First load, fetch metadata to get column information
            if (this.columns.length === 0) {
                // Use fetchMetadata() to leverage globalMetadata cache and avoid redundant requests (issue #783)
                const metadata = await this.fetchMetadata(this.options.tableTypeId);

                // Auto-set table title from metadata if not explicitly provided
                if (!this.options.title && (metadata.val || metadata.value || metadata.name)) {
                    this.options.title = metadata.val || metadata.value || metadata.name;
                }

                // Store export flag from metadata (issue #1469)
                this.tableExportAllowed = metadata.export === '1' || metadata.export === 1;

                // Store table-level granted value for access control (issue #1508)
                this.tableGranted = metadata.granted !== undefined ? metadata.granted : null;

                // Convert metadata to columns format
                const columns = [];

                // Determine main column editability: WRITE if table is writable (issue #1508)
                const mainColGranted = this.isTableWritable() ? 1 : 0;

                // Add main value column (use metadata.id as column id for correct FR_{id} filter params - issue #793)
                columns.push({
                    id: String(metadata.id),
                    type: metadata.type || 'SHORT',
                    format: this.mapTypeIdToFormat(metadata.type || 'SHORT'),
                    name: metadata.val || metadata.name || 'Значение',
                    granted: mainColGranted,
                    ref: 0,
                    orig: metadata.id,
                    unique: metadata.unique, // Store unique flag for column edit form (issue #1026)
                    paramId: metadata.id // For cell editing: use t{metadata.id} for first column
                });

                // Add requisite columns (use req.id as column id for correct FR_{id} filter params - issue #793)
                if (metadata.reqs && Array.isArray(metadata.reqs)) {
                    metadata.reqs.forEach((req, idx) => {
                        const attrs = this.parseAttrs(req.attrs);
                        const isReference = req.hasOwnProperty('ref_id');
                        // Use req.granted if table is not fully writable; otherwise treat as writable (issue #1508)
                        const reqGranted = this.isTableWritable() ? 1 : (req.granted === 'WRITE' ? 1 : 0);
                        columns.push({
                            id: String(req.id),
                            type: req.type || 'SHORT',
                            // Use 'REF' format for reference fields to enable dropdown filter (issue #795)
                            format: isReference ? 'REF' : this.mapTypeIdToFormat(req.type || 'SHORT'),
                            name: attrs.alias || req.val,
                            val: req.val, // Store original name for alias display (issue #945)
                            granted: reqGranted,  // Use metadata granted for access control (issue #1508)
                            ref: isReference ? req.orig : 0,
                            ref_id: req.ref_id || null,
                            orig: req.orig || null,
                            attrs: req.attrs || '',
                            unique: req.unique, // Store unique flag for column edit form (issue #1026)
                            paramId: req.id, // For cell editing: use t{req.id} for requisite columns
                            arr_id: req.arr_id || null // For table requisites (subordinate tables) (issue #710)
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
