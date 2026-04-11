        updateRefFilterTriggerDisplay(colId) {
            const trigger = this.container.querySelector(`.filter-ref-trigger[data-column-id="${colId}"]`);
            if (!trigger) return;

            const currentFilter = this.filters[colId];
            const cachedOptions = this.refOptionsCache[colId] || [];

            // Parse currently selected IDs from filter value
            const selectedIds = new Set();
            if (currentFilter && currentFilter.value && currentFilter.type !== '%' && currentFilter.type !== '!%') {
                const rawVal = currentFilter.value;
                const inMatch = rawVal.match(/^@IN\((.+)\)$/);
                if (inMatch) {
                    inMatch[1].split(',').forEach(id => {
                        const trimmed = id.trim();
                        if (trimmed) selectedIds.add(trimmed);
                    });
                } else if (rawVal.startsWith('@')) {
                    const id = rawVal.substring(1);
                    if (id) selectedIds.add(id);
                }
            }

            // Build display text
            let displayText = '';
            if (selectedIds.size > 0) {
                const selectedTexts = cachedOptions
                    .filter(([id]) => selectedIds.has(String(id)))
                    .map(([, text]) => text);
                if (selectedTexts.length > 0) {
                    displayText = selectedTexts.length > 2
                        ? `${selectedTexts.length} выбрано`
                        : selectedTexts.join(', ');
                } else {
                    displayText = `${selectedIds.size} выбрано`;
                }
            }

            const textEl = trigger.querySelector('.filter-ref-trigger-text');
            if (textEl) {
                textEl.textContent = displayText || 'Выбрать...';
                textEl.classList.toggle('filter-ref-trigger-text--placeholder', !displayText);
            }
            trigger.dataset.selectedIds = Array.from(selectedIds).join(',');
            trigger.title = displayText || 'Выбрать значение...';
        }

        /**
         * Open a floating dropdown for reference field filter selection (issue #797).
         * The dropdown appears on top of the filter row and includes a search field.
         * @param {string} colId - Column ID
         * @param {HTMLElement} triggerElement - The trigger button element
         */
        openRefFilterDropdown(colId, triggerElement) {
            // Close any existing dropdown
            this.closeRefFilterDropdown();

            const cachedOptions = this.refOptionsCache[colId] || [];
            const currentFilter = this.filters[colId] || { type: '=', value: '' };

            // Parse currently selected IDs
            const selectedIds = new Set();
            if (currentFilter.value && currentFilter.type !== '%' && currentFilter.type !== '!%') {
                const rawVal = currentFilter.value;
                const inMatch = rawVal.match(/^@IN\((.+)\)$/);
                if (inMatch) {
                    inMatch[1].split(',').forEach(id => {
                        const trimmed = id.trim();
                        if (trimmed) selectedIds.add(trimmed);
                    });
                } else if (rawVal.startsWith('@')) {
                    const id = rawVal.substring(1);
                    if (id) selectedIds.add(id);
                }
            }

            // Create dropdown overlay
            const dropdown = document.createElement('div');
            dropdown.className = 'filter-ref-dropdown-overlay';
            dropdown.dataset.columnId = colId;

            // Build options HTML with checkboxes
            const optionsHtml = cachedOptions.length > 0
                ? cachedOptions.map(([id, text]) => {
                    const isSelected = selectedIds.has(String(id));
                    const escapedText = String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `
                        <label class="filter-ref-option" data-id="${id}">
                            <input type="checkbox" value="${id}" ${isSelected ? 'checked' : ''}>
                            <span class="filter-ref-option-text">${escapedText}</span>
                        </label>
                    `;
                }).join('')
                : '<div class="filter-ref-empty">Загрузка...</div>';

            dropdown.innerHTML = `
                <div class="filter-ref-dropdown-header">
                    <input type="text"
                           class="filter-ref-search"
                           placeholder="Поиск..."
                           autocomplete="off">
                    <button type="button" class="filter-ref-clear" title="Очистить выбор">✕</button>
                </div>
                <div class="filter-ref-options">
                    ${optionsHtml}
                </div>
            `;

            // Position the dropdown below the trigger
            document.body.appendChild(dropdown);

            const rect = triggerElement.getBoundingClientRect();
            const dropdownHeight = Math.min(300, window.innerHeight - rect.bottom - 20);

            dropdown.style.position = 'fixed';
            dropdown.style.top = `${rect.bottom + 2}px`;
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.minWidth = `${Math.max(rect.width, 200)}px`;
            dropdown.style.maxHeight = `${dropdownHeight}px`;
            dropdown.style.zIndex = '10000';

            // Adjust position if dropdown would go off-screen to the right
            const dropdownRect = dropdown.getBoundingClientRect();
            if (dropdownRect.right > window.innerWidth - 10) {
                dropdown.style.left = `${window.innerWidth - dropdownRect.width - 10}px`;
            }

            // Store reference to current dropdown
            this.currentRefFilterDropdown = {
                element: dropdown,
                colId: colId,
                triggerElement: triggerElement,
                cachedOptions: cachedOptions
            };

            // Focus search input
            const searchInput = dropdown.querySelector('.filter-ref-search');
            searchInput.focus();

            // Handle search input
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                const searchText = e.target.value.trim().toLowerCase();
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.filterRefDropdownOptions(searchText);
                }, 150);
            });

            // Handle checkbox changes
            const optionsContainer = dropdown.querySelector('.filter-ref-options');
            optionsContainer.addEventListener('change', (e) => {
                if (e.target.type === 'checkbox') {
                    this.handleRefFilterSelection(colId);
                }
            });

            // Handle clear button
            const clearBtn = dropdown.querySelector('.filter-ref-clear');
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Uncheck all checkboxes
                dropdown.querySelectorAll('.filter-ref-option input[type="checkbox"]').forEach(cb => {
                    cb.checked = false;
                });
                this.handleRefFilterSelection(colId);
            });

            // Handle keyboard events
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeRefFilterDropdown();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.closeRefFilterDropdown();
                }
            });

            // Close dropdown when clicking outside
            setTimeout(() => {
                document.addEventListener('click', this.handleRefFilterDropdownOutsideClick);
            }, 0);
        }

        /**
         * Handle outside click to close reference filter dropdown (issue #797).
         */
        handleRefFilterDropdownOutsideClick = (e) => {
            if (!this.currentRefFilterDropdown) return;
            const dropdown = this.currentRefFilterDropdown.element;
            const trigger = this.currentRefFilterDropdown.triggerElement;
            if (!dropdown.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
                this.closeRefFilterDropdown();
            }
        }

        /**
         * Filter options in the reference filter dropdown based on search text (issue #797).
         * @param {string} searchText - Search text to filter by
         */
        filterRefDropdownOptions(searchText) {
            if (!this.currentRefFilterDropdown) return;
            const dropdown = this.currentRefFilterDropdown.element;
            const options = dropdown.querySelectorAll('.filter-ref-option');

            options.forEach(option => {
                const text = option.querySelector('.filter-ref-option-text').textContent.toLowerCase();
                const matches = !searchText || text.includes(searchText);
                option.style.display = matches ? '' : 'none';
            });
        }

        /**
         * Handle selection change in reference filter dropdown (issue #797).
         * Updates the filter state and reloads data.
         * @param {string} colId - Column ID
         */
        handleRefFilterSelection(colId) {
            if (!this.currentRefFilterDropdown) return;
            const dropdown = this.currentRefFilterDropdown.element;

            // Get selected IDs
            const selectedIds = [];
            dropdown.querySelectorAll('.filter-ref-option input[type="checkbox"]:checked').forEach(cb => {
                selectedIds.push(cb.value);
            });

            // Update filter state
            if (!this.filters[colId]) {
                this.filters[colId] = { type: '=', value: '' };
            }

            if (selectedIds.length === 0) {
                // No selection - clear filter
                this.filters[colId].value = '';
                this.filters[colId].type = '=';
            } else if (selectedIds.length === 1) {
                // Single selection: store as @{id}
                this.filters[colId].value = '@' + selectedIds[0];
                this.filters[colId].type = '=';
            } else {
                // Multiple selection: store as @IN(id1,id2,...)
                this.filters[colId].value = '@IN(' + selectedIds.join(',') + ')';
                this.filters[colId].type = '(,)';
            }

            // Update the filter icon
            const icon = this.container.querySelector(`.filter-icon-inside[data-column-id="${colId}"]`);
            if (icon) icon.textContent = this.filters[colId].type;

            // Update trigger display
            this.updateRefFilterTriggerDisplay(colId);

            // Check if this filter overrides URL GET parameters
            this.handleFilterOverride(colId, this.filters[colId].value);

            // Reload data immediately
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Close the reference filter dropdown (issue #797).
         */
        closeRefFilterDropdown() {
            if (this.currentRefFilterDropdown) {
                this.currentRefFilterDropdown.element.remove();
                this.currentRefFilterDropdown = null;
                document.removeEventListener('click', this.handleRefFilterDropdownOutsideClick);
            }
        }

        /**
         * Parse JSON object text into an array of [key, value] tuples preserving original order.
         * This is necessary because JavaScript objects reorder numeric string keys.
         * @param {string} jsonText - JSON text representing an object
         * @returns {Array<[string, string]>} Array of [id, text] tuples in original order
         */
        parseJsonObjectAsArray(jsonText) {
            const result = [];
            // Match "key": "value" or "key": value patterns, preserving order
            const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|([^,}\s]+))/g;
            let match;
            while ((match = regex.exec(jsonText)) !== null) {
                const key = match[1].replace(/\\(.)/g, '$1'); // Unescape
                const value = match[2] !== undefined
                    ? match[2].replace(/\\(.)/g, '$1')  // String value, unescape
                    : match[3];  // Non-string value (number, boolean, null)
                result.push([key, value]);
            }
            return result;
        }

        getMetadataName(metadata) {
            return metadata.val || metadata.name || metadata.title || `Тип #${ metadata.id || '?' }`;
        }

        /**
         * Extract error message from server response (issue #1506).
         * The server may return errors as {"error":"..."} or [{"error":"..."}].
         * Returns the error string if present, otherwise null.
         */
