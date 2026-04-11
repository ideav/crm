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
