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
         * @param {number} duration - How long to show the notification in ms (default 2000)
         */
        showCopyNotification(message, isError = false, duration = 2000) {
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
                font-size: 0.875rem;
                z-index: 10000;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                animation: fadeInOut ${duration / 1000}s ease-in-out;
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
            }, duration);
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

            // Display F_I as a visible filter on the first column for table data source (issue #861)
            // When F_I is present in URL and dataSource is 'table', show it as @{value} with '=' filter type
            // on the first column so the user can see and modify the active ID filter.
            if (this.options.recordId && this.getDataSourceType() === 'table' && this.columns.length > 0) {
                const firstColId = this.columns[0].id;
                // Only set if not already overridden by another URL filter for the same column
                if (!urlFilters[firstColId]) {
                    const recordIdValue = `@${this.options.recordId}`;
                    urlFilters[firstColId] = {
                        type: '=',
                        value: recordIdValue,
                        paramKey: 'F_I',
                        isRefId: true,
                        refId: this.options.recordId
                    };
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

            // Check for ID-based exclusion filter: !@{id} or !@(id1,id2,...) (issue #1819)
            const refExclIdMatch = rawValue.match(/^!@(\d+)$/);
            if (refExclIdMatch) {
                return { type: '!@', value: refExclIdMatch[1] };
            }
            const refExclListMatch = rawValue.match(/^!@\((.+)\)$/);
            if (refExclListMatch) {
                return { type: '!@', value: refExclListMatch[1] };
            }

            // Check for ID-based including-list filter: @(id1,id2,...) (issue #1819)
            const refInclListMatch = rawValue.match(/^@\((.+)\)$/);
            if (refInclListMatch) {
                return { type: '@', value: refInclListMatch[1] };
            }

            // Check for ID-based filter: @{id} means filter by record ID, not by text value (issue #551)
            // Example: FR_4547=@6753 means filter column 4547 by record ID 6753
            const refIdMatch = rawValue.match(/^@(\d+)$/);
            if (refIdMatch) {
                return { type: '=', value: rawValue, isRefId: true, refId: refIdMatch[1] };
            }

            // Check for ID-based IN list filter: @IN(id1,id2,...) for multi-select ref filters (issue #795)
            // Example: FR_115=@IN(145,146) means filter reference column 115 by IDs 145 and 146
            const refInMatch = rawValue.match(/^@IN\((.+)\)$/);
            if (refInMatch) {
                // Store the full @IN(...) value; applyFilter passes it through as-is using FR_{T}={X} format
                return { type: '(,)', value: rawValue };
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
                        <span class="hidden-filter-badge-remove" onclick="window.${instanceName}.removeUrlFilter('${hf.colId}')" title="Удалить фильтр"><i class="pi pi-times"></i></span>
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

            // Also clear @{id} record filter (issue #1392): when the table was opened with F_I=@{recordId}
            // (e.g. via URL or options.recordId), the filter is re-added by parseUrlFiltersFromParams()
            // on every loadData() call because options.recordId persists. Clear it so the user's
            // explicit "clear all filters" action removes this filter too.
            if (this.options.recordId) {
                this.options.recordId = null;
                this.overriddenUrlParams.add('F_I');
                // Remove F_I from browser URL if present
                const newUrlParams = new URLSearchParams(window.location.search);
                if (newUrlParams.has('F_I')) {
                    newUrlParams.delete('F_I');
                    const newUrl = window.location.pathname + (newUrlParams.toString() ? '?' + newUrlParams.toString() : '');
                    window.history.replaceState({}, '', newUrl);
                }
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
