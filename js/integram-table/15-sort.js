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
         * ORDER parameter value for the current sort state, or null when not sorting.
         * Tabular (subordinate-table) columns are sorted by the array type id (arr_id),
         * not the column's own req id — backend joins values by t=<ORDER_VAL> (issue #5087).
         */
        getOrderParamValue() {
            if (this.sortColumn === null || this.sortDirection === null) return null;
            const column = (this.columns || []).find(c => c.id === this.sortColumn);
            const sortId = (column && column.arr_id) ? column.arr_id : this.sortColumn;
            return this.sortDirection === 'desc' ? `-${ sortId }` : String(sortId);
        }

        /**
         * Reload table data with current filter parameters
         * This method resets the table state and reloads from the beginning
         * while preserving current filters, column settings, and other state
         */
