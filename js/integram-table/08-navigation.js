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

