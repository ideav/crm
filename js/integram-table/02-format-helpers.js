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
                unique: metadata.unique, // Store unique flag for column edit form (issue #1026)
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
                        // Use 'REF' format for reference fields to enable dropdown filter (issue #795)
                        format: isReference ? 'REF' : this.mapTypeIdToFormat(req.type || 'SHORT'),
                        name: attrs.alias || req.val,
                        val: req.val, // Store original name for alias display (issue #945)
                        granted: 1,  // In object format, allow editing all cells
                        ref: isReference ? req.orig : 0,
                        ref_id: req.ref_id || null,
                        orig: req.orig || null,
                        attrs: req.attrs || '',
                        unique: req.unique, // Store unique flag for column edit form (issue #1026)
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
                // Use fetchMetadata() to leverage globalMetadata cache and avoid redundant requests (issue #783)
                const metadata = await this.fetchMetadata(typeId);

                // Auto-set table title from metadata if not explicitly provided
                if (!this.options.title && (metadata.val || metadata.value)) {
                    this.options.title = metadata.val || metadata.value;
                }

                // Convert metadata to columns format
                const columns = [];

                // Add main value column (use metadata.id as column id for correct FR_{id} filter params - issue #793)
                columns.push({
                    id: String(metadata.id),
                    type: metadata.type || 'SHORT',
                    format: this.mapTypeIdToFormat(metadata.type || 'SHORT'),
                    name: metadata.val || metadata.name || 'Значение',
                    granted: 1,
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

                        columns.push({
                            id: String(req.id),
                            type: req.type || 'SHORT',
                            // Use 'REF' format for reference fields to enable dropdown filter (issue #795)
                            format: isReference ? 'REF' : this.mapTypeIdToFormat(req.type || 'SHORT'),
                            name: attrs.alias || req.val,
                            val: req.val, // Store original name for alias display (issue #945)
                            granted: 1,  // In object format, allow editing all cells
                            ref: isReference ? req.orig : 0,
                            ref_id: req.ref_id || null,
                            orig: req.orig || null,
                            attrs: req.attrs || '',
                            unique: req.unique, // Store unique flag for column edit form (issue #1026)
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
