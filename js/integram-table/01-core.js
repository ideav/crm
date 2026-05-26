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
            this.isFetchingTotalCount = false;  // True while re-requesting the total count (issue #2795)
            this.hasMore = true;  // Whether there are more records to load
            this.isLoading = false;  // Prevent multiple simultaneous loads
            this.pendingRequests = 0;  // In-flight server requests; drives the toolbar AJAX spinner
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
                showReferences: false,  // false = hide references column (default), true = show reverse reference links (issue #1732)
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
                { symbol: '@', name: 'по ID: включая', format: 'FR_{ T }=@{ X }' },
                { symbol: '!@', name: 'по ID: исключая', format: 'FR_{ T }=!@{ X }' },
                { symbol: '~', name: 'содержит', format: 'FR_{ T }=%{ X }%' },
                { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                { symbol: '!', name: 'не содержит', format: 'FR_{ T }=!%{ X }%' },
                { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
            ];
            // Text-based filter types for REF columns - these use text input instead of dropdown (issue #799)
            // '@' and '!@' also use text input - user types IDs directly (issue #1819)
            this.refTextFilterTypes = new Set(['~', '^', '!', '@', '!@']);

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

        /**
         * Detect whether the server response has a different column count than
         * the cached metadata (issue #2526). Each row's `r` array carries
         * [mainValue, req1, req2, ..., reqN]; its length should equal the
         * current `this.columns.length`. When they differ, metadata has changed
         * on the server (e.g. a column was added or removed by another user)
         * and the cached columns are stale.
         * @param {Array} dataArray - Server response array of {i, u, o, r}.
         * @returns {boolean} True when at least one row's `r` length differs from this.columns.length.
         */
        hasRowColumnCountMismatch(dataArray) {
            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                return false;
            }
            if (!Array.isArray(this.columns) || this.columns.length === 0) {
                return false;
            }
            const expected = this.columns.length;
            return dataArray.some(item => Array.isArray(item.r) && item.r.length !== expected);
        }

        /**
         * Clear cached metadata and columns so the next load fetches fresh
         * data (issue #2526). Mirrors the pattern used after column edits in
         * issue #1400.
         */
        invalidateMetadataCache() {
            this.metadataCache = {};
            this.metadataFetchPromises = {};
            this.globalMetadata = null;
            this.globalMetadataPromise = null;
            this.columns = [];
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
                // can be recalculated based on the metadata ids.
                // Preserve scroll position since this resolves asynchronously and may
                // fire after the user has scrolled the table (issue #2744).
                if (this.columns.length > 0) {
                    this.renderPreservingScroll(() => this.render());
                }
            } catch (error) {
                console.error('Error loading global metadata:', error);
            }
        }

        /**
         * Load parent info when F_U filter is present and > 1 (issue #571, #1708)
         * Fetches parent record data from get_record/{parentId}
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
                const response = await fetch(`${ apiBase }/get_record/${ parentId }`);
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
                    // Re-render if data is already loaded, so the title updates.
                    // Preserve scroll position since this resolves asynchronously (issue #2744).
                    if (this.columns.length > 0) {
                        this.renderPreservingScroll(() => this.render());
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

                // Build onclick handler for record value: open edit modal for parent record (issue #1710)
                const parentRecordOnclick = `window.${ instanceName }.openEditForm('${ parentRecordId }', '${ parentObjId }', 0); event.preventDefault();`;

                // Parent table name links to table/{obj}, record value opens edit modal for parent record (issue #1710)
                return `<div class="integram-table-title-area">${ this.renderCheckboxToggleHtml() }<div class="integram-table-title"><a class="integram-title-link integram-parent-type-link" href="${ parentTypeLink }">${ parentTypeName }</a> <a class="integram-title-link integram-parent-record-link" href="#" onclick="${ parentRecordOnclick }">${ parentVal }</a>${ currentTitle ? ': ' + currentTitle : '' }</div>${ createBtnHtml }</div>`;
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
            // Block appending when there are no more records, and block scroll-triggered
            // appends while a new row is pending creation (issue #2059): re-rendering
            // would destroy the unsaved row and lose the editor focus.
            if ((append && !this.hasMore) || (append && this.pendingNewRow)) {
                return;
            }

            // Dedupe concurrent loads. When a load is already running, return its
            // in-flight promise instead of a no-op so callers that `await this.loadData(...)`
            // wait for columns/data to be rebuilt. Returning early used to leave
            // this.columns = [], which produced an empty "Настройки колонок таблицы" form
            // after deleting and immediately re-creating a column: closeColumnSettings()
            // fires an un-awaited refresh and the following `await this.loadData(...)`
            // short-circuited before the columns were rebuilt (issue #2824).
            // Non-append (refresh) calls are still allowed even when hasMore is false so the
            // refresh button keeps working (issue #1516).
            if (this.isLoading) {
                return this._loadDataPromise || undefined;
            }

            this.isLoading = true;
            this._loadDataPromise = this._runLoadData(append);
            try {
                return await this._loadDataPromise;
            } finally {
                this._loadDataPromise = null;
            }
        }

        async _runLoadData(append = false) {
            this.beginRequest();

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

                const appendScrollState = append ? this.captureScrollState() : null;
                this.render();
                this.restoreScrollState(appendScrollState);
                // Re-apply the scroll state after the browser has settled the new layout,
                // so late-firing layout shifts (ResizeObserver, font/image load, sticky-
                // scrollbar sync) can't snap the table back to scrollLeft=0 (issue #2744).
                if (appendScrollState && typeof window.requestAnimationFrame === 'function') {
                    window.requestAnimationFrame(() => this.restoreScrollState(appendScrollState));
                }
            } catch (error) {
                console.error('Error loading data:', error);
                // Stop auto-loading after a failed request (issue #2763).
                // handleLoadDataError() re-renders the table to keep the filter
                // row editable (issue #2758); the fresh wrapper has belowFold ≈ 0,
                // so checkAndLoadMore() (and the scroll listener) would otherwise
                // re-issue the same failing request in a loop. The filter UI and
                // refreshData reset hasMore = true when the user edits the filter
                // or clicks refresh, so the table is still recoverable.
                this.hasMore = false;
                this.handleLoadDataError(error, append);
            } finally {
                this.isLoading = false;
                this.endRequest();
                // Check if table fits on screen and needs more data
                this.checkAndLoadMore();
            }
        }

        beginRequest() {
            this.pendingRequests = (this.pendingRequests || 0) + 1;
            this.updateAjaxSpinner();
        }

        endRequest() {
            // Clamp at 0 so a stray endRequest() can't drive the counter negative.
            this.pendingRequests = Math.max(0, (this.pendingRequests || 0) - 1);
            this.updateAjaxSpinner();
        }

        // Mutates only the spinner DOM in place so concurrent requests don't trigger a full re-render.
        updateAjaxSpinner() {
            if (!this.container) return;
            const spinner = this.container.querySelector('.integram-table-ajax-spinner');
            if (!spinner) return;
            const pending = this.pendingRequests || 0;
            spinner.classList.toggle('active', pending > 0);
            const counter = spinner.querySelector('.integram-table-ajax-spinner-counter');
            if (counter) {
                counter.textContent = pending > 1 ? `(${ pending })` : '';
            }
        }

        /**
         * Surface a data-loading error without destroying the rendered table.
         * Issue #2758: replacing container.innerHTML on a failed filter request
         * removed the filter inputs, so users could not correct the bad input
         * (e.g. an empty IN(,) list). When columns are already loaded we keep the
         * existing layout (with an empty body) and show the error as a toast so
         * the filter row remains editable.
         */
        handleLoadDataError(error, append) {
            const message = (error && error.message) ? error.message : String(error);
            if (!this.container) {
                return;
            }

            if (this.columns.length > 0) {
                try {
                    this.render();
                } catch (renderError) {
                    console.error('Failed to re-render table after load error:', renderError);
                }
                this.showToast(`Ошибка загрузки данных: ${ message }`, 'error');
                return;
            }

            if (!append) {
                this.container.innerHTML = `<div class="alert alert-danger">Ошибка загрузки данных: ${ message }</div>`;
            } else {
                this.showToast(`Ошибка загрузки данных: ${ message }`, 'error');
            }
        }

        /**
         * Fetch a URL and parse the response as JSON.
         * When the server returns a non-JSON payload (e.g. a plaintext error like
         * "Couldn't extract ..."), surface that text so the user sees the actual
         * server message instead of a cryptic "Unexpected token ..." parse error
         * (issue #2758).
         */
        async fetchJson(url) {
            const response = await fetch(url);
            const text = await response.text();

            try {
                return text === '' ? null : JSON.parse(text);
            } catch (parseError) {
                const trimmed = (text || '').trim();
                const preview = trimmed
                    ? trimmed.slice(0, 300)
                    : `HTTP ${ response.status } ${ response.statusText }`.trim();
                const error = new Error(preview);
                error.isNonJsonResponse = true;
                error.status = response.status;
                throw error;
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
            const json = await this.fetchJson(`${ this.options.apiUrl }${ separator }${ params }`);

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

        isNumericTableTypeId(value) {
            return /^\d+$/.test(String(value || '').trim());
        }

        extractTableTypeIdFromApiUrl() {
            const url = this.options.apiUrl || '';

            // Supports /object/{id-or-name} and /metadata/{id-or-name}.
            const endpointMatch = url.match(/\/(?:object|metadata)\/([^\/?#]+)/);
            if (endpointMatch) {
                return endpointMatch[1];
            }

            // Preserve the older numeric fallback for custom paths like /api/789.
            const genericMatch = url.match(/\/(\d+)(?:\/|\?|$)/);
            return genericMatch ? genericMatch[1] : null;
        }

        getMetadataLookupVariants(value) {
            const variants = [];
            const add = val => {
                const normalized = String(val || '').trim();
                if (normalized && !variants.includes(normalized)) {
                    variants.push(normalized);
                }
            };

            add(value);

            try {
                add(decodeURIComponent(String(value || '').replace(/\+/g, ' ')));
            } catch (e) {
                // Keep the raw value when it is not a valid percent-encoded path segment.
            }

            return variants;
        }

        metadataNameMatches(value, lookupVariants) {
            const name = String(value || '').trim();
            return lookupVariants.some(lookup => name === lookup);
        }

        metadataNameMatchesInsensitive(value, lookupVariants) {
            const name = String(value || '').trim().toLocaleLowerCase();
            return lookupVariants.some(lookup => name === lookup.toLocaleLowerCase());
        }

        pickBestMetadataNameMatch(matches, lookupVariants) {
            if (matches.length <= 1 || !Array.isArray(this.globalMetadata)) {
                return matches[0] || null;
            }

            const referencedTableIds = new Set();
            this.globalMetadata.forEach(item => {
                (item.reqs || []).forEach(req => {
                    if (!this.metadataNameMatches(req.val, lookupVariants)) {
                        return;
                    }
                    if (req.arr_id) {
                        referencedTableIds.add(String(req.arr_id));
                    }
                    if (req.orig) {
                        referencedTableIds.add(String(req.orig));
                    }
                });
            });

            let best = matches[0];
            let bestScore = -1;
            matches.forEach((item, index) => {
                let score = 0;
                const id = String(item.id);

                // Subordinate table requisites point to the actual table id via arr_id/orig.
                if (referencedTableIds.has(id)) {
                    score += 1000;
                }

                // When duplicate names exist, prefer the richer table definition.
                if (Array.isArray(item.reqs) && item.reqs.length > 0) {
                    score += 100;
                }

                // Preserve metadata order for otherwise equal candidates.
                score -= index;

                if (score > bestScore) {
                    bestScore = score;
                    best = item;
                }
            });

            return best;
        }

        findMetadataItemByName(nameOrPathSegment) {
            if (!Array.isArray(this.globalMetadata)) {
                return null;
            }

            const lookupVariants = this.getMetadataLookupVariants(nameOrPathSegment);
            if (lookupVariants.length === 0) {
                return null;
            }

            const exactMatches = this.globalMetadata.filter(item =>
                this.metadataNameMatches(item.val || item.value || item.name, lookupVariants)
            );
            if (exactMatches.length > 0) {
                return this.pickBestMetadataNameMatch(exactMatches, lookupVariants);
            }

            const insensitiveMatches = this.globalMetadata.filter(item =>
                this.metadataNameMatchesInsensitive(item.val || item.value || item.name, lookupVariants)
            );
            return this.pickBestMetadataNameMatch(insensitiveMatches, lookupVariants);
        }

        async resolveTableTypeId(typeIdOrName) {
            const rawValue = String(typeIdOrName || '').trim();
            if (!rawValue) {
                return null;
            }

            if (this.isNumericTableTypeId(rawValue)) {
                return rawValue;
            }

            if (this.globalMetadataPromise) {
                await this.globalMetadataPromise;
            }

            if (!this.globalMetadata) {
                this.globalMetadataPromise = null;
                this.globalMetadataPromise = this.loadGlobalMetadata();
                await this.globalMetadataPromise;
            }

            const metadataItem = this.findMetadataItemByName(rawValue);
            return metadataItem && metadataItem.id ? String(metadataItem.id) : null;
        }

        async loadDataFromTable(append = false) {
            // Table-based data loading using object/{typeId}/?JSON_OBJ&F_U={parentId}
            // Auto-detect tableTypeId from URL if not explicitly provided (issue #699)
            // Resolve /metadata/{name} and /object/{name} through global metadata (issue #2302).
            if (!this.options.tableTypeId || !this.isNumericTableTypeId(this.options.tableTypeId)) {
                let typeId = this.options.tableTypeId || this.extractTableTypeIdFromApiUrl();

                if (!typeId && this.objectTableId) {
                    typeId = this.objectTableId;
                }

                const resolvedTypeId = await this.resolveTableTypeId(typeId);

                if (!resolvedTypeId) {
                    throw new Error(`tableTypeId is required for dataSource=table. Cannot auto-detect from apiUrl: ${this.options.apiUrl}. Expected patterns: /object/{id-or-name}, /metadata/{id-or-name}, or /{id}`);
                }

                this.options.tableTypeId = resolvedTypeId;
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
                        columns.push(this.buildColumnFromMetadataReq(req));
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

            const data = await this.fetchJson(dataUrl);

            // Detect metadata drift: rows whose `r` length differs from the
            // current column count mean another user changed the table schema
            // while we were viewing it (issue #2526). Refresh metadata and
            // rebuild the columns from scratch.
            if (this.hasRowColumnCountMismatch(data)) {
                this.invalidateMetadataCache();
                const refreshedMetadata = await this.fetchMetadata(this.options.tableTypeId);

                if (!this.options.title && (refreshedMetadata.val || refreshedMetadata.value || refreshedMetadata.name)) {
                    this.options.title = refreshedMetadata.val || refreshedMetadata.value || refreshedMetadata.name;
                }
                this.tableExportAllowed = refreshedMetadata.export === '1' || refreshedMetadata.export === 1;
                this.tableGranted = refreshedMetadata.granted !== undefined ? refreshedMetadata.granted : null;

                const refreshedColumns = [];
                const mainColGranted = this.isTableWritable() ? 1 : 0;
                refreshedColumns.push({
                    id: String(refreshedMetadata.id),
                    type: refreshedMetadata.type || 'SHORT',
                    format: this.mapTypeIdToFormat(refreshedMetadata.type || 'SHORT'),
                    name: refreshedMetadata.val || refreshedMetadata.name || 'Значение',
                    granted: mainColGranted,
                    ref: 0,
                    orig: refreshedMetadata.id,
                    unique: refreshedMetadata.unique,
                    paramId: refreshedMetadata.id
                });
                if (refreshedMetadata.reqs && Array.isArray(refreshedMetadata.reqs)) {
                    refreshedMetadata.reqs.forEach(req => {
                        refreshedColumns.push(this.buildColumnFromMetadataReq(req));
                    });
                }
                this.columns = refreshedColumns;
            }

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
