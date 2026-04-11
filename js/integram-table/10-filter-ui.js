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
                    const oldType = this.filters[columnId]?.type;
                    if (!this.filters[columnId]) {
                        this.filters[columnId] = { type: this.getDefaultFilterType(format), value: '' };
                    }
                    this.filters[columnId].type = symbol;
                    target.textContent = symbol;
                    menu.remove();

                    // Check if this filter overrides URL GET parameters (issue #500)
                    // This handles filter type changes, including Empty/Not Empty filters
                    this.handleFilterOverride(columnId, this.filters[columnId].value || symbol);

                    // For REF columns, check if we need to switch between text input and dropdown modes (issue #799)
                    if (format === 'REF') {
                        const wasTextBased = this.refTextFilterTypes.has(oldType);
                        const isTextBased = this.refTextFilterTypes.has(symbol);

                        // If mode changed, clear the filter value and re-render
                        if (wasTextBased !== isTextBased) {
                            this.filters[columnId].value = '';
                            // Close any open dropdown
                            if (this.currentRefFilterDropdown && this.currentRefFilterDropdown.colId === columnId) {
                                this.closeRefFilterDropdown();
                            }
                            // Re-render to switch between text input and dropdown
                            this.render();
                            return;
                        }
                    }

                    // For DATE/DATETIME columns, re-render when switching between date-picker types
                    // and non-picker types (e.g. switching from '=' to '...' changes input from date to text) (issue #1008)
                    if (format === 'DATE' || format === 'DATETIME') {
                        const datePickerTypes = new Set(['=', '≥', '≤', '>', '<']);
                        const wasDatePicker = datePickerTypes.has(oldType);
                        const isDatePicker = datePickerTypes.has(symbol);
                        if (wasDatePicker !== isDatePicker) {
                            this.filters[columnId].value = '';
                            this.render();
                            return;
                        }
                    }

                    // For Empty (%) and Not Empty (!%) filters, clear input and apply immediately
                    if (symbol === '%' || symbol === '!%') {
                        this.filters[columnId].value = '';

                        // Clear the input field (for regular text inputs)
                        const filterInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${columnId}"]`);
                        if (filterInput) {
                            filterInput.value = '';
                        }
                        // Clear selection on REF filter triggers (issue #795, #797)
                        // Close any open dropdown and update trigger display
                        if (this.currentRefFilterDropdown && this.currentRefFilterDropdown.colId === columnId) {
                            this.closeRefFilterDropdown();
                        }
                        this.updateRefFilterTriggerDisplay(columnId);

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

            // The first column (index 0) cannot be moved and cannot be a drop target (issue #958)
            if (draggedIndex === 0 || targetIndex === 0) return;

            // Adjust targetIndex: removing draggedId shifts all elements after it left by one (issue #962)
            const adjustedTargetIndex = targetIndex > draggedIndex ? targetIndex - 1 : targetIndex;

            // If the column would end up in the same position, skip all side effects (issue #966)
            if (adjustedTargetIndex === draggedIndex) return;

            this.columnOrder.splice(draggedIndex, 1);
            this.columnOrder.splice(adjustedTargetIndex, 0, draggedId);

            this.saveColumnState();

            // Persist the new column order to the backend (issue #951, #956, #958)
            // Use the full columnOrder (not filtered by visibility) so that hidden columns
            // can also be reordered from the settings panel.
            // The first column occupies index 0 and is excluded from counting.
            // The server expects a 1-based position among requisites only (not counting the first column),
            // so a column at index N in columnOrder should be sent as order=N (index equals 1-based req position).
            const newOrderIndex = this.columnOrder.indexOf(draggedId);
            if (newOrderIndex >= 0) {
                const newOrder = newOrderIndex; // 1-based position among requisites (first column at index 0 is not counted)
                this.saveColumnOrderToServer(draggedId, newOrder);
            }

            this.render();
        }

        /**
         * Save the new order of a column to the server (issue #951).
         * POST _d_ord/{columnId}?JSON with order={1-based position} and _xsrf token.
         */
        async saveColumnOrderToServer(columnId, order) {
            try {
                const apiBase = this.getApiBase();
                const params = new URLSearchParams();
                params.append('order', order);
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }
                await fetch(`${apiBase}/_d_ord/${columnId}?JSON`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
            } catch (e) {
                // Silently ignore errors — the local order is already updated
                if (this.options.debug) {
                    console.warn('[IntegramTable] saveColumnOrderToServer error:', e);
                }
            }
        }
        /*
         * Returns SVG icon and tooltip for a column type (issue #945, #949)
         */
