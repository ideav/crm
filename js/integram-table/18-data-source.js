        getServerError(result) {
            if (Array.isArray(result)) {
                return (result[0] && result[0].error) || null;
            }
            return result.error || null;
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
         * Determine whether the export button should be shown (issue #1469).
         * For report sources: always allowed.
         * For table/object sources: only when metadata has export="1".
         * @returns {boolean}
         */
        isExportAllowed() {
            const sourceType = this.getDataSourceType();
            if (sourceType === 'report') {
                return true;
            }
            // For table/object sources, only allow if metadata export flag is set
            return this.tableExportAllowed === true;
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
                alias: null,
                defaultValue: null
            };

            if (!attrs) return result;

            result.required = attrs.includes(':!NULL:');
            result.multi = attrs.includes(':MULTI:');

            const aliasMatch = attrs.match(/:ALIAS=(.*?):/u);
            if (aliasMatch) {
                result.alias = aliasMatch[1];
            }

            // Extract default value: strip all known flags and use the remainder
            let stripped = attrs
                .replace(/:!NULL:/g, '')
                .replace(/:MULTI:/g, '')
                .replace(/:ALIAS=(.*?):/gu, '')
                .trim();
            if (stripped.length > 0) {
                result.defaultValue = stripped;
            }

            return result;
        }

        /**
         * Resolve a default value for a field based on attrs and field format (issue #1498)
         * Supports built-in tokens like [NOW], [TODAY], [USER_ID], etc.
         * For DATE/DATETIME formats with no attrs default, returns current date/time.
         * @param {string|null} rawAttrs - The raw attrs string from column metadata
         * @param {string} format - The field format (DATE, DATETIME, SHORT, etc.)
         * @returns {string} Resolved default value, or empty string if none
         */
        resolveDefaultValue(rawAttrs, format, suppressDateFallback = false) {
            const now = new Date();

            // Helper to format date as DD.MM.YYYY
            const formatDate = (d) => {
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}.${mm}.${yyyy}`;
            };

            // Helper to format datetime as DD.MM.YYYY HH:MM:SS
            const formatDateTime = (d) => {
                const date = formatDate(d);
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return `${date} ${hh}:${min}:${ss}`;
            };

            // Helper for date arithmetic
            const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
            const addMonths = (d, months) => {
                const r = new Date(d);
                r.setMonth(r.getMonth() + months);
                return r;
            };

            // If attrs has a default value token, try to resolve it
            if (rawAttrs && rawAttrs.trim().length > 0) {
                const parsed = this.parseAttrs(rawAttrs);
                const token = parsed.defaultValue;
                if (token) {
                    switch (token) {
                        case '[NOW]':      return formatDateTime(now);
                        case '[TODAY]':    return formatDate(now);
                        case '[YESTERDAY]': return formatDate(addDays(now, -1));
                        case '[TOMORROW]':  return formatDate(addDays(now, 1));
                        case '[MONTH_AGO]': return formatDate(addMonths(now, -1));
                        case '[WEEK_AGO]':  return formatDate(addDays(now, -7));
                        case '[MONTH_PLUS]': return formatDate(addMonths(now, 1));
                        case '[USER]':     return (typeof name !== 'undefined' ? name : '');
                        case '[USER_ID]':  return (typeof uid !== 'undefined' ? String(uid) : '');
                        case '[ROLE]':     return (typeof role !== 'undefined' ? role : '');
                        case '[ROLE_ID]':  return (typeof roleId !== 'undefined' ? String(roleId) : '');
                        case '[HTTP_HOST]':    return window.location.hostname || '';
                        case '[REQUEST_URI]':  return window.location.pathname + window.location.search || '';
                        default:
                            // Unknown token or literal value — return as-is
                            return token;
                    }
                }
            }

            // No attrs default — apply current date/time for date/datetime fields (unless suppressed)
            if (!suppressDateFallback) {
                if (format === 'DATE') {
                    return formatDate(now);
                } else if (format === 'DATETIME') {
                    return formatDateTime(now);
                }
            }

            return '';
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

