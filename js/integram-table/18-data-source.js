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

