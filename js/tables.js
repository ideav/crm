// ============================================================
// Tables Workplace Controller
// ============================================================

class TablesController {
    constructor() {
        // Default folder configuration
        this.defaultConfig = {
            "Избранное": { "open": true, "tabs": ["18", "42"] },
            "Справочники": { "open": true, "tabs": [] },
            "Служебные": { "open": false, "tabs": ["22", "269"] },
            "Скрытые": { "open": false, "tabs": ["47", "65", "137", "29", "63"] }
        };

        // Current configuration
        this.config = null;
        this.settingsID = null;

        // Tables data from API
        this.tables = [];

        // Type icons mapping (PrimeVue icons)
        this.typeIcons = {
            2: 'pi pi-code',              // HTML
            3: 'pi pi-file',              // SHORT
            4: 'pi pi-clock',             // DATETIME
            5: 'pi pi-lock',              // GRANT
            8: 'pi pi-align-left',        // CHARS
            9: 'pi pi-calendar',          // DATE
            12: 'pi pi-file-edit',        // MEMO
            13: 'pi pi-hashtag',          // NUMBER
            14: 'pi pi-sort-numeric-down',// SIGNED
            16: 'pi pi-table'             // REPORT_COLUMN
        };

        // Drag and drop state
        this.draggedTable = null;
        this.draggedFolder = null;
    }

    async init() {
        // Load saved configuration
        this.loadConfig();

        // Load tables from API
        await this.loadTables();

        // Render folders and tables
        this.render();

        // Setup event handlers
        this.setupEventHandlers();
        this.setupSearch();
        this.setupModals();
    }

    loadConfig() {
        // Check if myTablesSet was populated by templater
        if (typeof myTablesSet !== 'undefined' && Object.keys(myTablesSet).length > 0) {
            // Get the first (and likely only) key
            const keys = Object.keys(myTablesSet);
            if (keys.length > 0) {
                this.settingsID = keys[0];
                const settingsData = myTablesSet[this.settingsID];
                // settingsData is like {'UI': '{"Избранное":...}'}
                const settingsType = Object.keys(settingsData)[0];
                const settingsJson = settingsData[settingsType];
                try {
                    this.config = JSON.parse(settingsJson);
                    console.log('[tables] Loaded saved config:', this.config);
                } catch (e) {
                    console.error('[tables] Error parsing saved config:', e);
                    this.config = JSON.parse(JSON.stringify(this.defaultConfig));
                }
            } else {
                this.config = JSON.parse(JSON.stringify(this.defaultConfig));
            }
        } else {
            this.config = JSON.parse(JSON.stringify(this.defaultConfig));
        }
    }

    async loadTables() {
        const loadingEl = document.getElementById('tables-loading');

        try {
            // GET /terms?JSON
            const url = '/' + db + '/terms?JSON';
            console.log('[tables] Loading tables from:', url);

            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            this.tables = await response.json();
            console.log('[tables] Loaded tables:', this.tables);

        } catch (err) {
            console.error('[tables] Error loading tables:', err);
            // Use demo data if API fails
            this.tables = [
                { id: 18, type: 3, name: "User" },
                { id: 42, type: 3, name: "Role" },
                { id: 22, type: 3, name: "Query" },
                { id: 269, type: 3, name: "Settings" }
            ];
        } finally {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }
    }

    render() {
        const container = document.getElementById('tables-container');
        if (!container) return;

        // Clear container but keep loading element
        const loadingEl = document.getElementById('tables-loading');
        container.innerHTML = '';

        // Build a set of table IDs that are already in folders
        const assignedTables = new Set();
        Object.values(this.config).forEach(folder => {
            (folder.tabs || []).forEach(id => assignedTables.add(String(id)));
        });

        // Render each folder
        Object.entries(this.config).forEach(([folderName, folderData], folderIndex) => {
            const folderEl = this.createFolderElement(folderName, folderData, folderIndex);
            container.appendChild(folderEl);
        });

        // Add "Unassigned" folder for tables not in any folder
        const unassignedTables = this.tables.filter(t => !assignedTables.has(String(t.id)));
        if (unassignedTables.length > 0) {
            const unassignedEl = this.createFolderElement('Без папки', {
                open: true,
                tabs: unassignedTables.map(t => String(t.id))
            }, Object.keys(this.config).length, true);
            container.appendChild(unassignedEl);
        }

        // Add "Add folder" button
        const addFolderBtn = document.createElement('button');
        addFolderBtn.className = 'add-folder-btn';
        addFolderBtn.innerHTML = '<span>+</span> Добавить папку';
        addFolderBtn.addEventListener('click', () => this.showNewFolderModal());
        container.appendChild(addFolderBtn);
    }

    createFolderElement(folderName, folderData, folderIndex, isVirtual = false) {
        const folderEl = document.createElement('div');
        folderEl.className = 'folder' + (folderData.open ? '' : ' collapsed');
        folderEl.dataset.folder = folderName;
        folderEl.draggable = !isVirtual;

        // Folder header
        const header = document.createElement('div');
        header.className = 'folder-header';

        const toggle = document.createElement('i');
        toggle.className = 'folder-toggle pi pi-chevron-down';

        const icon = document.createElement('i');
        icon.className = 'folder-icon pi ' + (folderData.open ? 'pi-folder-open' : 'pi-folder');

        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = folderName;

        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = (folderData.tabs || []).length;

        header.appendChild(toggle);
        header.appendChild(icon);
        header.appendChild(name);
        header.appendChild(count);

        // Folder actions (not for virtual folders)
        if (isVirtual) {
            const actionsSpacer = document.createElement('div');
            actionsSpacer.className = 'folder-actions-spacer';
            header.appendChild(actionsSpacer);
        } else {
            const actions = document.createElement('div');
            actions.className = 'folder-actions';

            const renameBtn = document.createElement('button');
            renameBtn.className = 'folder-action-btn';
            renameBtn.innerHTML = '<i class="pi pi-pencil"></i>';
            renameBtn.title = 'Переименовать';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameFolder(folderName, folderEl);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'folder-action-btn delete';
            deleteBtn.innerHTML = '<i class="pi pi-trash"></i>';
            deleteBtn.title = 'Удалить';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteFolder(folderName);
            });

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);
            header.appendChild(actions);
        }

        // Toggle folder on header click
        header.addEventListener('click', () => {
            folderEl.classList.toggle('collapsed');
            const isOpen = !folderEl.classList.contains('collapsed');
            icon.className = 'folder-icon pi ' + (isOpen ? 'pi-folder-open' : 'pi-folder');

            if (!isVirtual) {
                this.config[folderName].open = isOpen;
                this.saveConfig();
            }
        });

        folderEl.appendChild(header);

        // Folder content
        const content = document.createElement('div');
        content.className = 'folder-content';

        const tabIds = folderData.tabs || [];
        if (tabIds.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'folder-empty';
            emptyMsg.textContent = 'Перетащите таблицы сюда';
            content.appendChild(emptyMsg);
        } else {
            tabIds.forEach(tableId => {
                const table = this.tables.find(t => String(t.id) === String(tableId));
                if (table) {
                    const tableCard = this.createTableCard(table);
                    content.appendChild(tableCard);
                }
            });
        }

        folderEl.appendChild(content);

        // Setup drag and drop for folder
        this.setupFolderDragDrop(folderEl, folderName, isVirtual);

        return folderEl;
    }

    createTableCard(table) {
        const card = document.createElement('a');
        card.className = 'table-card';
        card.href = '/' + db + '/table/' + table.id;
        card.dataset.tableId = table.id;
        card.dataset.tableName = table.name.toLowerCase();
        card.draggable = true;

        const icon = document.createElement('i');
        icon.className = 'table-card-icon type-' + (table.type || 3) + ' ' + (this.typeIcons[table.type] || this.typeIcons[3]);

        const name = document.createElement('span');
        name.className = 'table-card-name';
        name.textContent = table.name;

        card.appendChild(icon);
        card.appendChild(name);

        // Setup drag events
        card.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            this.draggedTable = table.id;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', table.id);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            this.draggedTable = null;
        });

        // Prevent navigation on drag
        card.addEventListener('click', (e) => {
            if (card.classList.contains('dragging')) {
                e.preventDefault();
            }
        });

        return card;
    }

    setupFolderDragDrop(folderEl, folderName, isVirtual) {
        const content = folderEl.querySelector('.folder-content');
        const header = folderEl.querySelector('.folder-header');

        // Allow dropping tables into folder content
        content.addEventListener('dragover', (e) => {
            if (this.draggedTable) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                folderEl.classList.add('drag-over');
            }
        });

        content.addEventListener('dragleave', (e) => {
            if (!content.contains(e.relatedTarget)) {
                folderEl.classList.remove('drag-over');
            }
        });

        content.addEventListener('drop', (e) => {
            e.preventDefault();
            folderEl.classList.remove('drag-over');

            if (this.draggedTable && !isVirtual) {
                this.moveTableToFolder(this.draggedTable, folderName);
            }
        });

        // Allow dropping tables onto folder header (especially for collapsed folders)
        header.addEventListener('dragover', (e) => {
            if (this.draggedTable) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                folderEl.classList.add('drag-over');
            }
        });

        header.addEventListener('dragleave', (e) => {
            if (!header.contains(e.relatedTarget)) {
                folderEl.classList.remove('drag-over');
            }
        });

        header.addEventListener('drop', (e) => {
            if (this.draggedTable && !isVirtual) {
                e.preventDefault();
                e.stopPropagation();
                folderEl.classList.remove('drag-over');
                this.moveTableToFolder(this.draggedTable, folderName);
            }
        });

        // Folder reordering (not for virtual folders)
        if (!isVirtual) {
            folderEl.addEventListener('dragstart', (e) => {
                if (e.target === folderEl) {
                    this.draggedFolder = folderName;
                    folderEl.classList.add('dragging');
                }
            });

            folderEl.addEventListener('dragend', () => {
                folderEl.classList.remove('dragging');
                this.draggedFolder = null;
            });

            folderEl.addEventListener('dragover', (e) => {
                if (this.draggedFolder && this.draggedFolder !== folderName) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }
            });

            folderEl.addEventListener('drop', (e) => {
                if (this.draggedFolder && this.draggedFolder !== folderName) {
                    e.preventDefault();
                    this.reorderFolders(this.draggedFolder, folderName);
                }
            });
        }
    }

    moveTableToFolder(tableId, targetFolder) {
        tableId = String(tableId);

        // Remove from all folders
        Object.keys(this.config).forEach(folder => {
            const tabs = this.config[folder].tabs || [];
            const index = tabs.indexOf(tableId);
            if (index > -1) {
                tabs.splice(index, 1);
            }
        });

        // Add to target folder
        if (!this.config[targetFolder].tabs) {
            this.config[targetFolder].tabs = [];
        }
        if (!this.config[targetFolder].tabs.includes(tableId)) {
            this.config[targetFolder].tabs.push(tableId);
        }

        this.saveConfig();
        this.render();
    }

    reorderFolders(draggedFolder, targetFolder) {
        const entries = Object.entries(this.config);
        const draggedIndex = entries.findIndex(([name]) => name === draggedFolder);
        const targetIndex = entries.findIndex(([name]) => name === targetFolder);

        if (draggedIndex > -1 && targetIndex > -1) {
            const [removed] = entries.splice(draggedIndex, 1);
            entries.splice(targetIndex, 0, removed);

            // Rebuild config with new order
            this.config = Object.fromEntries(entries);
            this.saveConfig();
            this.render();
        }
    }

    renameFolder(oldName, folderEl) {
        const nameSpan = folderEl.querySelector('.folder-name');
        if (!nameSpan || nameSpan.isEditing) return;

        nameSpan.isEditing = true;
        const originalName = oldName;

        // Make the name editable
        nameSpan.contentEditable = 'true';
        nameSpan.classList.add('editing');
        nameSpan.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(nameSpan);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const finishEditing = (save) => {
            if (!nameSpan.isEditing) return;
            nameSpan.isEditing = false;
            nameSpan.contentEditable = 'false';
            nameSpan.classList.remove('editing');

            const newName = nameSpan.textContent.trim();

            if (save && newName && newName !== originalName) {
                // Check if name already exists
                if (this.config[newName]) {
                    // Show error tooltip instead of alert
                    this.showInlineError(nameSpan, 'Папка с таким названием уже существует');
                    nameSpan.textContent = originalName;
                    return;
                }

                // Preserve order while renaming
                const entries = Object.entries(this.config);
                const index = entries.findIndex(([name]) => name === originalName);
                if (index > -1) {
                    entries[index][0] = newName;
                    this.config = Object.fromEntries(entries);
                    this.saveConfig();
                    this.render();
                }
            } else {
                // Restore original name
                nameSpan.textContent = originalName;
            }
        };

        // Handle blur (click outside)
        nameSpan.addEventListener('blur', () => finishEditing(true), { once: true });

        // Handle keyboard
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameSpan.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing(false);
            }
        });
    }

    showInlineError(element, message) {
        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'inline-error-tooltip';
        tooltip.textContent = message;

        // Position tooltip
        const rect = element.getBoundingClientRect();
        tooltip.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.bottom + 4}px;
            z-index: 10000;
        `;

        document.body.appendChild(tooltip);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            tooltip.remove();
        }, 3000);
    }

    async deleteFolder(folderName) {
        const confirmed = await this.showDeleteConfirmModal(
            'Удалить папку "' + folderName + '"? Таблицы будут перемещены в "Без папки".'
        );
        if (confirmed) {
            delete this.config[folderName];
            this.saveConfig();
            this.render();
        }
    }

    /**
     * Show a custom modal confirmation dialog for delete action
     * @param {string} message - The confirmation message to display
     * @returns {Promise<boolean>} - true if user confirmed, false otherwise
     */
    showDeleteConfirmModal(message) {
        return new Promise((resolve) => {
            const modalId = `tables-delete-confirm-${ Date.now() }`;
            const modalHtml = `
                <div class="modal" id="${ modalId }">
                    <div class="modal-backdrop"></div>
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2>Подтверждение удаления</h2>
                            <button type="button" class="modal-close tables-delete-confirm-cancel"><i class="pi pi-times"></i></button>
                        </div>
                        <div class="modal-body">
                            <p style="margin: 0 0 1.5rem 0;">${ message }</p>
                            <div class="form-actions">
                                <button type="button" class="btn-danger tables-delete-confirm-ok">Удалить</button>
                                <button type="button" class="btn-secondary tables-delete-confirm-cancel">Отменить</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            const confirmModal = document.getElementById(modalId);

            const cleanup = (result) => {
                document.removeEventListener('keydown', handleEscape);
                confirmModal.remove();
                resolve(result);
            };

            // OK button
            confirmModal.querySelector('.tables-delete-confirm-ok').addEventListener('click', () => cleanup(true));

            // Cancel buttons (both X and Cancel button)
            confirmModal.querySelectorAll('.tables-delete-confirm-cancel').forEach(btn => {
                btn.addEventListener('click', () => cleanup(false));
            });

            // Close on backdrop click
            confirmModal.querySelector('.modal-backdrop').addEventListener('click', () => cleanup(false));

            // Close on Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    cleanup(false);
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    addFolder(name) {
        if (!name || !name.trim()) return;

        name = name.trim();
        if (this.config[name]) {
            this.showErrorModal('Папка с таким названием уже существует');
            return;
        }

        // Add new folder at the top
        const entries = Object.entries(this.config);
        entries.unshift([name, { open: true, tabs: [] }]);
        this.config = Object.fromEntries(entries);

        this.saveConfig();
        this.render();
    }

    /**
     * Show an error modal dialog
     * @param {string} message - The error message to display
     */
    showErrorModal(message) {
        const modalId = `tables-error-${ Date.now() }`;
        const modalHtml = `
            <div class="modal" id="${ modalId }">
                <div class="modal-backdrop"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 style="color: #dc3545;">Ошибка</h2>
                        <button type="button" class="modal-close tables-error-close"><i class="pi pi-times"></i></button>
                    </div>
                    <div class="modal-body">
                        <p style="margin: 0 0 1.5rem 0;">${ message }</p>
                        <div class="form-actions">
                            <button type="button" class="btn-secondary tables-error-close">Закрыть</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const errorModal = document.getElementById(modalId);

        const cleanup = () => {
            document.removeEventListener('keydown', handleEscape);
            errorModal.remove();
        };

        // Close buttons
        errorModal.querySelectorAll('.tables-error-close').forEach(btn => {
            btn.addEventListener('click', cleanup);
        });

        // Close on backdrop click
        errorModal.querySelector('.modal-backdrop').addEventListener('click', cleanup);

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cleanup();
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    async saveConfig() {
        const configJson = JSON.stringify(this.config);
        console.log('[tables] Saving config:', configJson);

        try {
            const vars = new FormData();
            vars.append('_xsrf', xsrf);
            vars.append('t273', configJson);

            let url;
            if (this.settingsID) {
                // Update existing settings
                url = '/' + db + '/_m_save/' + this.settingsID + '?JSON';
            } else {
                // Create new settings
                vars.append('t269', user);
                vars.append('t271', 'UI');
                url = '/' + db + '/_m_new/269?JSON&up=1';
            }

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: vars
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const result = await response.json();
            console.log('[tables] Config saved:', result);

            // If created new settings, save the ID
            if (!this.settingsID && result.id) {
                this.settingsID = result.id;
            }

        } catch (err) {
            console.error('[tables] Error saving config:', err);
        }
    }

    setupEventHandlers() {
        // Add table button
        const addTableBtn = document.getElementById('add-table-btn');
        if (addTableBtn) {
            addTableBtn.addEventListener('click', () => this.showNewTableModal());
        }
    }

    setupSearch() {
        const searchInput = document.getElementById('tables-search');
        if (!searchInput) return;

        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.filterTables(e.target.value);
            }, 200);
        });
    }

    filterTables(query) {
        query = query.toLowerCase().trim();
        const cards = document.querySelectorAll('.table-card');

        if (!query) {
            // Show all tables
            cards.forEach(card => {
                card.classList.remove('search-hidden', 'search-match');
            });
            // Restore folder collapsed states
            document.querySelectorAll('.folder').forEach(folder => {
                const folderName = folder.dataset.folder;
                if (this.config[folderName]) {
                    folder.classList.toggle('collapsed', !this.config[folderName].open);
                }
            });
            return;
        }

        // Expand all folders when searching
        document.querySelectorAll('.folder').forEach(folder => {
            folder.classList.remove('collapsed');
        });

        // Filter tables
        cards.forEach(card => {
            const tableName = card.dataset.tableName || '';
            const matches = tableName.includes(query);
            card.classList.toggle('search-hidden', !matches);
            card.classList.toggle('search-match', matches);
        });
    }

    setupModals() {
        // New table modal
        const newTableModal = document.getElementById('new-table-modal');
        const closeNewTableBtn = document.getElementById('close-new-table-modal');
        const cancelNewTableBtn = document.getElementById('cancel-new-table');
        const newTableForm = document.getElementById('new-table-form');

        if (closeNewTableBtn) {
            closeNewTableBtn.addEventListener('click', () => this.hideNewTableModal());
        }
        if (cancelNewTableBtn) {
            cancelNewTableBtn.addEventListener('click', () => this.hideNewTableModal());
        }
        if (newTableModal) {
            newTableModal.querySelector('.modal-backdrop').addEventListener('click', () => this.hideNewTableModal());
        }
        if (newTableForm) {
            newTableForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createNewTable();
            });
        }

        // New folder modal
        const newFolderModal = document.getElementById('new-folder-modal');
        const closeNewFolderBtn = document.getElementById('close-new-folder-modal');
        const cancelNewFolderBtn = document.getElementById('cancel-new-folder');
        const newFolderForm = document.getElementById('new-folder-form');

        if (closeNewFolderBtn) {
            closeNewFolderBtn.addEventListener('click', () => this.hideNewFolderModal());
        }
        if (cancelNewFolderBtn) {
            cancelNewFolderBtn.addEventListener('click', () => this.hideNewFolderModal());
        }
        if (newFolderModal) {
            newFolderModal.querySelector('.modal-backdrop').addEventListener('click', () => this.hideNewFolderModal());
        }
        if (newFolderForm) {
            newFolderForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const nameInput = document.getElementById('new-folder-name');
                if (nameInput && nameInput.value) {
                    this.addFolder(nameInput.value);
                    this.hideNewFolderModal();
                    nameInput.value = '';
                }
            });
        }
    }

    showNewTableModal() {
        const modal = document.getElementById('new-table-modal');
        if (modal) {
            modal.style.display = '';
            document.getElementById('new-table-name')?.focus();
        }
    }

    hideNewTableModal() {
        const modal = document.getElementById('new-table-modal');
        if (modal) {
            modal.style.display = 'none';
            document.getElementById('new-table-form')?.reset();
        }
    }

    showNewFolderModal() {
        const modal = document.getElementById('new-folder-modal');
        if (modal) {
            modal.style.display = '';
            document.getElementById('new-folder-name')?.focus();
        }
    }

    hideNewFolderModal() {
        const modal = document.getElementById('new-folder-modal');
        if (modal) {
            modal.style.display = 'none';
            document.getElementById('new-folder-form')?.reset();
        }
    }

    async createNewTable() {
        const nameInput = document.getElementById('new-table-name');
        const typeSelect = document.getElementById('new-table-type');
        const uniqueCheckbox = document.getElementById('new-table-unique');

        if (!nameInput || !typeSelect) return;

        const name = nameInput.value.trim();
        const type = typeSelect.value;
        const unique = uniqueCheckbox && uniqueCheckbox.checked;

        if (!name) {
            this.showErrorModal('Введите название таблицы');
            return;
        }

        try {
            // Create new table via _d_new API
            // _d_new creates a table with 1 column based on type
            const vars = new FormData();
            vars.append('_xsrf', xsrf);
            vars.append('t', type);    // Base type ID
            vars.append('val', name);  // Table name
            if (unique) {
                vars.append('unique', '1');  // Unique values flag
            }

            const response = await fetch('/' + db + '/_d_new?JSON=1', {
                method: 'POST',
                credentials: 'include',
                body: vars
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            const result = await response.json();
            console.log('[tables] New table created:', result);

            // Add to first folder (result.obj contains the new table ID)
            if (result.obj) {
                const firstFolder = Object.keys(this.config)[0];
                if (firstFolder) {
                    if (!this.config[firstFolder].tabs) {
                        this.config[firstFolder].tabs = [];
                    }
                    this.config[firstFolder].tabs.unshift(String(result.obj));
                    await this.saveConfig();
                }

                // Reload tables
                await this.loadTables();
                this.render();
            }

            this.hideNewTableModal();

        } catch (err) {
            console.error('[tables] Error creating table:', err);
            this.showErrorModal('Ошибка при создании таблицы: ' + err.message);
        }
    }
}

// Initialize tables controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for global variables to be defined
    setTimeout(() => {
        const tablesController = new TablesController();
        tablesController.init();
        window.tablesController = tablesController;
    }, 100);
});
