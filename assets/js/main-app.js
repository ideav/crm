// ============================================================
// Main Application Controller
// ============================================================

// PrimeVue icons commonly used for menu items
const PRIMEVUE_ICONS = [
    'pi-home', 'pi-user', 'pi-users', 'pi-cog', 'pi-file', 'pi-folder', 'pi-folder-open',
    'pi-calendar', 'pi-clock', 'pi-bell', 'pi-envelope', 'pi-inbox', 'pi-send',
    'pi-search', 'pi-filter', 'pi-sort-alt', 'pi-list', 'pi-th-large', 'pi-table',
    'pi-chart-bar', 'pi-chart-line', 'pi-chart-pie', 'pi-percentage',
    'pi-shopping-cart', 'pi-shopping-bag', 'pi-credit-card', 'pi-wallet', 'pi-money-bill',
    'pi-briefcase', 'pi-building', 'pi-map', 'pi-map-marker', 'pi-globe',
    'pi-phone', 'pi-mobile', 'pi-desktop', 'pi-tablet', 'pi-server',
    'pi-database', 'pi-cloud', 'pi-cloud-upload', 'pi-cloud-download',
    'pi-file-edit', 'pi-file-pdf', 'pi-file-excel', 'pi-file-word', 'pi-image',
    'pi-camera', 'pi-video', 'pi-play', 'pi-pause', 'pi-stop',
    'pi-check', 'pi-check-circle', 'pi-times', 'pi-times-circle', 'pi-exclamation-triangle',
    'pi-info-circle', 'pi-question-circle', 'pi-ban', 'pi-lock', 'pi-unlock',
    'pi-key', 'pi-shield', 'pi-eye', 'pi-eye-slash', 'pi-pencil',
    'pi-trash', 'pi-plus', 'pi-minus', 'pi-star', 'pi-star-fill',
    'pi-heart', 'pi-heart-fill', 'pi-bookmark', 'pi-tag', 'pi-tags',
    'pi-link', 'pi-external-link', 'pi-share-alt', 'pi-copy', 'pi-download',
    'pi-upload', 'pi-print', 'pi-save', 'pi-refresh', 'pi-sync',
    'pi-arrow-up', 'pi-arrow-down', 'pi-arrow-left', 'pi-arrow-right',
    'pi-chevron-up', 'pi-chevron-down', 'pi-chevron-left', 'pi-chevron-right',
    'pi-angle-up', 'pi-angle-down', 'pi-angle-left', 'pi-angle-right',
    'pi-bars', 'pi-ellipsis-h', 'pi-ellipsis-v', 'pi-grip-vertical',
    'pi-palette', 'pi-sliders-h', 'pi-sliders-v', 'pi-wrench', 'pi-bolt',
    'pi-sun', 'pi-moon', 'pi-box', 'pi-sitemap', 'pi-ticket',
    'pi-comments', 'pi-comment', 'pi-id-card', 'pi-qrcode', 'pi-barcode',
    'pi-flag', 'pi-flag-fill', 'pi-crown', 'pi-gift', 'pi-car',
    'pi-truck', 'pi-directions', 'pi-compass', 'pi-stopwatch', 'pi-hourglass',
    'pi-calculator', 'pi-code', 'pi-at', 'pi-hashtag', 'pi-percentage'
];

class MainAppController {
    constructor() {
        this.i18n = window._app ? window._app.i18n : null;
        this.theme = window._app ? window._app.theme : null;
        this.editMode = false;
        this.draggedItem = null;
        this.menuItems = {}; // Map of menu_id to menu item data
        this.menuElements = {}; // Map of menu_id to DOM elements
    }

    /**
     * Decodes HTML entities that may have been escaped by server-side template.
     * Handles: &lt; &gt; &amp; &quot; &#xxxxx; (numeric entities)
     * @param {string} str - String with possibly escaped HTML entities
     * @returns {string} - Decoded string
     */
    decodeHtmlEntities(str) {
        if (!str) return str;
        const textarea = document.createElement('textarea');
        textarea.innerHTML = str;
        return textarea.value;
    }

    init() {
        this.setupSidebarToggle();
        this.setupSidebarResize();
        this.setupUserMenuDropdown();
        this.setupLogout();
        this.buildMenu();
        this.highlightActiveMenuItem();
        this.initUserAvatar();
        this.setupEditMode();
    }

    setupSidebarToggle() {
        const sidebar = document.getElementById('app-sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (!sidebar || !toggleBtn) return;

        // Restore collapsed state from localStorage
        const storageKey = 'appSidebarCollapsed_' + (typeof db !== 'undefined' ? db : 'default');
        if (localStorage.getItem(storageKey) === 'true') {
            sidebar.classList.add('collapsed');
        }

        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem(storageKey, isCollapsed ? 'true' : 'false');
        });
    }

    setupSidebarResize() {
        const sidebar = document.getElementById('app-sidebar');
        if (!sidebar) return;

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'sidebar-resize-handle';
        sidebar.appendChild(resizeHandle);

        // Restore width from cookie
        const cookieName = 'sidebarWidth_' + (typeof db !== 'undefined' ? db : 'default');
        const savedWidth = this.getCookie(cookieName);
        if (savedWidth && !sidebar.classList.contains('collapsed')) {
            sidebar.style.width = savedWidth + 'px';
        }

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (sidebar.classList.contains('collapsed')) return;
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const width = startWidth + (e.clientX - startX);
            if (width >= 150 && width <= 400) {
                sidebar.style.width = width + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Save width to cookie (expires in 365 days)
            const width = sidebar.offsetWidth;
            this.setCookie(cookieName, width, 365);
        });
    }

    getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
    }

    buildMenu() {
        const menuContainer = document.getElementById('app-menu');
        if (!menuContainer || typeof menuData === 'undefined' || !Array.isArray(menuData)) return;

        // Clear existing menu
        menuContainer.innerHTML = '';
        this.menuItems = {};
        this.menuElements = {};

        // Build map of menu items by menu_id
        const itemMap = {};
        menuData.forEach(item => {
            if (item.menu_id) {
                itemMap[item.menu_id] = item;
                this.menuItems[item.menu_id] = { ...item };
            }
        });

        // Identify top-level items (menu_up is empty or doesn't exist in itemMap)
        const topLevel = [];
        const children = {};

        menuData.forEach(item => {
            const parentId = item.menu_up;
            if (!parentId || !itemMap[parentId]) {
                // Top-level item
                topLevel.push(item);
            } else {
                // Child item
                if (!children[parentId]) {
                    children[parentId] = [];
                }
                children[parentId].push(item);
            }
        });

        // Render menu items recursively
        const renderItems = (items, level, parentId = null) => {
            const fragment = document.createDocumentFragment();
            items.forEach(item => {
                const hasChildren = children[item.menu_id] && children[item.menu_id].length > 0;
                const menuItem = this.createMenuItem(item, level, hasChildren);
                this.menuElements[item.menu_id] = menuItem;
                fragment.appendChild(menuItem);

                if (hasChildren) {
                    const submenu = document.createElement('div');
                    submenu.className = 'app-submenu';
                    submenu.setAttribute('data-parent', item.menu_id);
                    submenu.appendChild(renderItems(children[item.menu_id], level + 1, item.menu_id));
                    fragment.appendChild(submenu);
                }
            });

            // Add "Add item" button at the end (visible in edit mode)
            const addBtn = document.createElement('button');
            addBtn.className = 'menu-item-add';
            addBtn.type = 'button';
            addBtn.innerHTML = '<i class="pi pi-plus"></i><span>Добавить пункт</span>';
            addBtn.setAttribute('data-parent-id', parentId || '');
            addBtn.setAttribute('data-level', level);
            addBtn.addEventListener('click', () => this.showAddItemModal(parentId, level));
            fragment.appendChild(addBtn);

            return fragment;
        };

        menuContainer.appendChild(renderItems(topLevel, 0));
    }

    createMenuItem(item, level, hasChildren) {
        const dbName = typeof db !== 'undefined' ? db : '';
        const href = item.href || '';

        const menuItem = document.createElement(hasChildren && !href ? 'button' : 'a');
        menuItem.className = 'app-menu-item';
        menuItem.setAttribute('data-menu-id', item.menu_id);
        menuItem.setAttribute('data-menu-up', item.menu_up || '');
        menuItem.setAttribute('data-level', level);
        menuItem.setAttribute('draggable', 'false'); // Will be enabled in edit mode

        if (level > 0) {
            menuItem.classList.add('app-menu-item-nested');
            menuItem.style.paddingLeft = (1 + level * 1) + 'rem';
        }
        if (hasChildren) {
            menuItem.classList.add('app-menu-item-parent');
        }

        if (hasChildren && !href) {
            menuItem.type = 'button';
        } else {
            menuItem.href = '/' + dbName + '/' + href;
            menuItem.setAttribute('data-href', href);
        }

        // Icon - decode HTML entities that may have been escaped by server template
        const iconSpan = document.createElement('span');
        iconSpan.className = 'menu-icon';
        const rawIcon = item.icon || '';
        const icon = this.decodeHtmlEntities(rawIcon);
        if (icon && icon.indexOf('<') !== -1) {
            // HTML icon (e.g., <i class="pi pi-bars"></i>)
            iconSpan.innerHTML = icon;
        } else if (icon && icon.trim() !== '') {
            // Emoji or HTML entity (decoded)
            iconSpan.innerHTML = icon;
        } else {
            // Default: PrimeIcons pi-file
            iconSpan.innerHTML = '<i class="pi pi-file"></i>';
        }
        menuItem.appendChild(iconSpan);

        // Text
        const textSpan = document.createElement('span');
        textSpan.className = 'menu-text';
        textSpan.textContent = item.name || '';
        menuItem.appendChild(textSpan);

        // Action buttons (visible in edit mode)
        const actionsSpan = document.createElement('span');
        actionsSpan.className = 'menu-item-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'menu-action-btn edit';
        editBtn.type = 'button';
        editBtn.title = 'Настроить';
        editBtn.innerHTML = '<i class="pi pi-pencil"></i>';
        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showEditItemModal(item.menu_id);
        });
        actionsSpan.appendChild(editBtn);

        menuItem.appendChild(actionsSpan);

        // Expand/collapse arrow for parent items
        if (hasChildren) {
            const arrowSpan = document.createElement('i');
            arrowSpan.className = 'menu-arrow pi pi-chevron-down';
            menuItem.appendChild(arrowSpan);

            menuItem.addEventListener('click', (e) => {
                if (this.editMode) return; // Don't toggle in edit mode
                if (!href || hasChildren) {
                    e.preventDefault();
                    const submenu = menuItem.nextElementSibling;
                    if (submenu && submenu.classList.contains('app-submenu')) {
                        const isExpanded = submenu.classList.toggle('expanded');
                        menuItem.classList.toggle('expanded', isExpanded);
                    }
                }
            });
        }

        // Setup drag and drop handlers (will be active only in edit mode)
        this.setupDragDropHandlers(menuItem);

        return menuItem;
    }

    setupEditMode() {
        const sidebar = document.getElementById('app-sidebar');
        const settingsBtn = document.getElementById('sidebar-settings');
        if (!sidebar || !settingsBtn) return;

        settingsBtn.addEventListener('click', () => {
            this.editMode = !this.editMode;
            sidebar.classList.toggle('edit-mode', this.editMode);
            settingsBtn.classList.toggle('active', this.editMode);

            // Enable/disable dragging on menu items
            document.querySelectorAll('.app-menu-item').forEach(item => {
                item.setAttribute('draggable', this.editMode ? 'true' : 'false');
            });
        });
    }

    setupDragDropHandlers(menuItem) {
        menuItem.addEventListener('dragstart', (e) => {
            if (!this.editMode) {
                e.preventDefault();
                return;
            }
            this.draggedItem = menuItem;
            menuItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', menuItem.getAttribute('data-menu-id'));
        });

        menuItem.addEventListener('dragend', () => {
            if (this.draggedItem) {
                this.draggedItem.classList.remove('dragging');
                this.draggedItem = null;
            }
            // Remove all drag-over classes
            document.querySelectorAll('.drag-over, .drag-over-parent').forEach(el => {
                el.classList.remove('drag-over', 'drag-over-parent');
            });
        });

        menuItem.addEventListener('dragover', (e) => {
            if (!this.editMode || !this.draggedItem || this.draggedItem === menuItem) {
                return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const rect = menuItem.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const threshold = rect.height * 0.25;

            menuItem.classList.remove('drag-over', 'drag-over-parent');

            if (e.clientY < midY - threshold) {
                // Insert before
                menuItem.classList.add('drag-over');
            } else if (e.clientY > midY + threshold) {
                // Insert after (show on next item or at bottom)
                menuItem.classList.add('drag-over');
            } else {
                // Make child
                menuItem.classList.add('drag-over-parent');
            }
        });

        menuItem.addEventListener('dragleave', () => {
            menuItem.classList.remove('drag-over', 'drag-over-parent');
        });

        menuItem.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!this.editMode || !this.draggedItem || this.draggedItem === menuItem) {
                return;
            }

            const draggedId = this.draggedItem.getAttribute('data-menu-id');
            const targetId = menuItem.getAttribute('data-menu-id');
            const targetParentId = menuItem.getAttribute('data-menu-up');

            const rect = menuItem.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const threshold = rect.height * 0.25;

            menuItem.classList.remove('drag-over', 'drag-over-parent');

            if (e.clientY < midY - threshold || e.clientY > midY + threshold) {
                // Reorder within same parent
                this.handleReorder(draggedId, targetId, targetParentId, e.clientY < midY);
            } else {
                // Move under this item as child
                this.handleReparent(draggedId, targetId);
            }
        });
    }

    async handleReorder(draggedId, targetId, targetParentId, insertBefore) {
        const draggedParentId = this.draggedItem.getAttribute('data-menu-up');

        // If moving to different parent, do reparent first
        if (draggedParentId !== targetParentId) {
            await this.handleReparent(draggedId, targetParentId || null, targetId, insertBefore);
            return;
        }

        // Calculate new order - get all siblings in the same parent
        const siblings = Array.from(document.querySelectorAll(
            `.app-menu-item[data-menu-up="${targetParentId}"]`
        )).filter(el => el !== this.draggedItem);

        const targetIndex = siblings.findIndex(el => el.getAttribute('data-menu-id') === targetId);
        const newOrder = insertBefore ? targetIndex + 1 : targetIndex + 2; // API uses 1-based indexing

        const dbName = typeof db !== 'undefined' ? db : '';
        try {
            const response = await fetch('/' + dbName + '/_m_ord/' + draggedId + '?JSON', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: '_xsrf=' + encodeURIComponent(window.xsrf) + '&order=' + newOrder
            });

            if (response.ok) {
                // Update local menuData and rebuild menu
                this.rebuildMenuFromDOM();
            } else {
                console.error('Failed to reorder menu item:', response.status);
            }
        } catch (err) {
            console.error('Error reordering menu item:', err);
        }
    }

    async handleReparent(draggedId, newParentId, targetSiblingId = null, insertBefore = false) {
        const dbName = typeof db !== 'undefined' ? db : '';
        try {
            const url = '/' + dbName + '/_m_move/' + draggedId + '?JSON' + (newParentId ? '&up=' + newParentId : '&up=');
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: '_xsrf=' + encodeURIComponent(window.xsrf)
            });

            if (response.ok) {
                // Update local data
                if (this.menuItems[draggedId]) {
                    this.menuItems[draggedId].menu_up = newParentId || '';
                }
                // Rebuild menu to reflect changes
                this.rebuildMenuFromDOM();
            } else {
                console.error('Failed to reparent menu item:', response.status);
            }
        } catch (err) {
            console.error('Error reparenting menu item:', err);
        }
    }

    rebuildMenuFromDOM() {
        // Reconstruct menuData from current DOM state
        const newMenuData = [];
        document.querySelectorAll('.app-menu-item[data-menu-id]').forEach(item => {
            const menuId = item.getAttribute('data-menu-id');
            if (this.menuItems[menuId]) {
                newMenuData.push(this.menuItems[menuId]);
            }
        });

        // Update global menuData if it exists
        if (typeof menuData !== 'undefined') {
            menuData.length = 0;
            newMenuData.forEach(item => menuData.push(item));
        }

        // Rebuild the menu
        this.buildMenu();
        this.highlightActiveMenuItem();

        // Restore edit mode if active
        if (this.editMode) {
            const sidebar = document.getElementById('app-sidebar');
            sidebar.classList.add('edit-mode');
            document.querySelectorAll('.app-menu-item').forEach(item => {
                item.setAttribute('draggable', 'true');
            });
        }
    }

    showAddItemModal(parentId, level) {
        this.showItemModal({
            mode: 'add',
            parentId: parentId,
            level: level,
            name: '',
            href: '',
            icon: ''
        });
    }

    showEditItemModal(menuId) {
        const item = this.menuItems[menuId];
        if (!item) return;

        this.showItemModal({
            mode: 'edit',
            menuId: menuId,
            name: item.name || '',
            href: item.href || '',
            icon: item.icon || ''
        });
    }

    showItemModal(config) {
        // Remove existing modal if any
        const existingModal = document.querySelector('.menu-modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 'menu-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'menu-modal';

        const title = config.mode === 'add' ? 'Добавить пункт меню' : 'Настройки пункта меню';

        modal.innerHTML = `
            <h3>${title}</h3>
            <div class="menu-modal-field">
                <label>Название</label>
                <input type="text" id="modal-name" value="${this.escapeHtml(config.name)}" placeholder="Название пункта меню">
            </div>
            <div class="menu-modal-field">
                <label>Адрес (URL)</label>
                <input type="text" id="modal-href" value="${this.escapeHtml(config.href)}" placeholder="example/page">
            </div>
            <div class="menu-modal-field">
                <label>Иконка</label>
                <div class="icon-picker">
                    <div class="icon-picker-tabs">
                        <button type="button" class="icon-picker-tab active" data-tab="primevue">PrimeVue</button>
                        <button type="button" class="icon-picker-tab" data-tab="emoji">Эмодзи</button>
                    </div>
                    <div class="icon-picker-content" id="icon-picker-primevue">
                        <div class="icon-picker-grid" id="primevue-icons-grid"></div>
                    </div>
                    <div class="icon-picker-content" id="icon-picker-emoji" style="display: none;">
                        <div class="emoji-input-wrapper">
                            <input type="text" id="modal-emoji" placeholder="Введите или вставьте эмодзи" maxlength="4">
                            <div class="emoji-preview" id="emoji-preview"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="menu-modal-actions">
                ${config.mode === 'edit' ? '<button type="button" class="menu-modal-btn delete">Удалить</button>' : ''}
                <button type="button" class="menu-modal-btn cancel">Отмена</button>
                <button type="button" class="menu-modal-btn save">Сохранить</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Populate PrimeVue icons
        const iconsGrid = modal.querySelector('#primevue-icons-grid');
        let selectedIcon = config.icon || '';

        PRIMEVUE_ICONS.forEach(iconClass => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-picker-item';
            btn.innerHTML = `<i class="pi ${iconClass}"></i>`;
            btn.setAttribute('data-icon', `<i class="pi ${iconClass}"></i>`);

            // Check if this icon is currently selected
            if (selectedIcon.includes(iconClass)) {
                btn.classList.add('selected');
            }

            btn.addEventListener('click', () => {
                iconsGrid.querySelectorAll('.icon-picker-item').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedIcon = btn.getAttribute('data-icon');
            });

            iconsGrid.appendChild(btn);
        });

        // Tab switching
        modal.querySelectorAll('.icon-picker-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                modal.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const tabName = tab.getAttribute('data-tab');
                modal.querySelector('#icon-picker-primevue').style.display = tabName === 'primevue' ? '' : 'none';
                modal.querySelector('#icon-picker-emoji').style.display = tabName === 'emoji' ? '' : 'none';
            });
        });

        // Emoji input preview
        const emojiInput = modal.querySelector('#modal-emoji');
        const emojiPreview = modal.querySelector('#emoji-preview');

        // If current icon is an emoji, show it
        if (config.icon && !config.icon.includes('<')) {
            emojiInput.value = config.icon;
            emojiPreview.textContent = config.icon;
            // Switch to emoji tab
            modal.querySelector('[data-tab="emoji"]').click();
        }

        emojiInput.addEventListener('input', () => {
            const emoji = emojiInput.value;
            emojiPreview.textContent = emoji;
            if (emoji) {
                selectedIcon = emoji;
                // Deselect PrimeVue icons
                iconsGrid.querySelectorAll('.icon-picker-item').forEach(b => b.classList.remove('selected'));
            }
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        // Cancel button
        modal.querySelector('.cancel').addEventListener('click', () => {
            overlay.remove();
        });

        // Save button
        modal.querySelector('.save').addEventListener('click', async () => {
            const name = modal.querySelector('#modal-name').value.trim();
            const href = modal.querySelector('#modal-href').value.trim();
            const emoji = modal.querySelector('#modal-emoji').value.trim();

            // Use emoji if entered, otherwise use selected PrimeVue icon
            const finalIcon = emoji || selectedIcon;

            if (!name) {
                alert('Введите название пункта меню');
                return;
            }

            if (config.mode === 'add') {
                await this.createMenuItemAPI(name, href, finalIcon, config.parentId);
            } else {
                await this.updateMenuItem(config.menuId, name, href, finalIcon);
            }

            overlay.remove();
        });

        // Delete button (only in edit mode)
        const deleteBtn = modal.querySelector('.delete');
        if (deleteBtn && config.mode === 'edit') {
            deleteBtn.addEventListener('click', async () => {
                const itemName = config.name || 'этот пункт';
                const hasChildren = this.hasChildMenuItems(config.menuId);
                let confirmMsg = `Удалить пункт "${itemName}"?`;
                if (hasChildren) {
                    confirmMsg = `Удалить пункт "${itemName}" и все его подпункты?`;
                }

                if (confirm(confirmMsg)) {
                    await this.deleteMenuItem(config.menuId);
                    overlay.remove();
                }
            });
        }

        // Focus name input
        setTimeout(() => {
            modal.querySelector('#modal-name').focus();
        }, 100);
    }

    hasChildMenuItems(menuId) {
        // Check if menu item has children
        for (const id in this.menuItems) {
            if (this.menuItems[id].menu_up === menuId) {
                return true;
            }
        }
        return false;
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
    }

    async createMenuItemAPI(name, href, icon, parentId) {
        // Create menu item via API
        // POST: /{db}/_m_new/151?JSON&up={parentId or roleId}
        // Parameters: t151 (name), t153 (href), t391 (icon)
        // Response: JSON with key 'obj' containing the new menu item ID

        const dbName = typeof db !== 'undefined' ? db : '';
        const upParam = parentId || (typeof window.roleId !== 'undefined' ? window.roleId : '');
        const url = '/' + dbName + '/_m_new/151?JSON&up=' + encodeURIComponent(upParam);

        const params = new URLSearchParams();
        params.append('_xsrf', window.xsrf || '');
        params.append('t151', name);
        params.append('t153', href);
        params.append('t391', icon);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.obj) {
                    // Successfully created - add to local data and rebuild menu
                    const newItem = {
                        menu_id: String(data.obj),
                        menu_up: parentId || '',
                        name: name,
                        href: href,
                        icon: icon
                    };
                    this.menuItems[newItem.menu_id] = newItem;

                    // Add to global menuData if it exists
                    if (typeof menuData !== 'undefined' && Array.isArray(menuData)) {
                        menuData.push(newItem);
                    }

                    // Rebuild menu to show new item
                    this.buildMenu();
                    this.highlightActiveMenuItem();

                    // Restore edit mode if active
                    if (this.editMode) {
                        const sidebar = document.getElementById('app-sidebar');
                        sidebar.classList.add('edit-mode');
                        document.querySelectorAll('.app-menu-item').forEach(item => {
                            item.setAttribute('draggable', 'true');
                        });
                    }
                } else {
                    console.error('Failed to create menu item: no obj in response', data);
                    alert('Ошибка создания пункта меню: сервер не вернул ID');
                }
            } else {
                console.error('Failed to create menu item:', response.status);
                alert('Ошибка создания пункта меню: ' + response.status);
            }
        } catch (err) {
            console.error('Error creating menu item:', err);
            alert('Ошибка создания пункта меню: ' + err.message);
        }
    }

    async updateMenuItem(menuId, name, href, icon) {
        // For updating menu items, we need to use the appropriate API
        // This typically involves updating the record in the menu table
        const item = this.menuItems[menuId];
        if (!item) return;

        // Update local data
        item.name = name;
        item.href = href;
        item.icon = icon;

        // Find and update the DOM element
        const menuElement = this.menuElements[menuId];
        if (menuElement) {
            const textSpan = menuElement.querySelector('.menu-text');
            if (textSpan) {
                textSpan.textContent = name;
            }
            const iconSpan = menuElement.querySelector('.menu-icon');
            if (iconSpan) {
                if (icon && icon.indexOf('<') !== -1) {
                    iconSpan.innerHTML = icon;
                } else if (icon && icon.trim() !== '') {
                    iconSpan.innerHTML = icon;
                } else {
                    iconSpan.innerHTML = '<i class="pi pi-file"></i>';
                }
            }
            if (href) {
                const dbName = typeof db !== 'undefined' ? db : '';
                menuElement.href = '/' + dbName + '/' + href;
                menuElement.setAttribute('data-href', href);
            }
        }

        // Note: Actual save to backend would require appropriate API endpoint
        // For name/href changes, this might use a record update endpoint
        console.log('Updated menu item locally:', { menuId, name, href, icon });
    }

    async deleteMenuItem(menuId) {
        // Delete menu item via API
        // POST: /{db}/_m_del/{id}?JSON
        // Note: Backend automatically deletes all subordinate menu items and renumbers

        const dbName = typeof db !== 'undefined' ? db : '';
        const url = '/' + dbName + '/_m_del/' + encodeURIComponent(menuId) + '?JSON';

        const params = new URLSearchParams();
        params.append('_xsrf', window.xsrf || '');

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            if (response.ok) {
                // Successfully deleted - remove from local data
                // Also remove all children (subordinate items)
                this.removeMenuItemAndChildren(menuId);

                // Rebuild menu to reflect changes
                this.buildMenu();
                this.highlightActiveMenuItem();

                // Restore edit mode if active
                if (this.editMode) {
                    const sidebar = document.getElementById('app-sidebar');
                    sidebar.classList.add('edit-mode');
                    document.querySelectorAll('.app-menu-item').forEach(item => {
                        item.setAttribute('draggable', 'true');
                    });
                }
            } else {
                console.error('Failed to delete menu item:', response.status);
                alert('Ошибка удаления пункта меню: ' + response.status);
            }
        } catch (err) {
            console.error('Error deleting menu item:', err);
            alert('Ошибка удаления пункта меню: ' + err.message);
        }
    }

    removeMenuItemAndChildren(menuId) {
        // Find all children of this menu item
        const childrenToRemove = [];
        const findChildren = (parentId) => {
            for (const id in this.menuItems) {
                if (this.menuItems[id].menu_up === parentId) {
                    childrenToRemove.push(id);
                    findChildren(id);
                }
            }
        };
        findChildren(menuId);

        // Remove children from local data
        childrenToRemove.forEach(id => {
            delete this.menuItems[id];
            delete this.menuElements[id];
        });

        // Remove the item itself
        delete this.menuItems[menuId];
        delete this.menuElements[menuId];

        // Update global menuData
        if (typeof menuData !== 'undefined' && Array.isArray(menuData)) {
            const idsToRemove = new Set([menuId, ...childrenToRemove]);
            for (let i = menuData.length - 1; i >= 0; i--) {
                if (idsToRemove.has(menuData[i].menu_id)) {
                    menuData.splice(i, 1);
                }
            }
        }
    }

    enableInlineRename(menuItem) {
        if (!this.editMode) return;

        const textSpan = menuItem.querySelector('.menu-text');
        if (!textSpan || menuItem.querySelector('.menu-text-input')) return;

        const currentName = textSpan.textContent;
        const menuId = menuItem.getAttribute('data-menu-id');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'menu-text-input';
        input.value = currentName;

        textSpan.style.display = 'none';
        textSpan.parentNode.insertBefore(input, textSpan.nextSibling);
        input.focus();
        input.select();

        const saveRename = async () => {
            const newName = input.value.trim();
            input.remove();
            textSpan.style.display = '';

            if (newName && newName !== currentName) {
                textSpan.textContent = newName;
                if (this.menuItems[menuId]) {
                    this.menuItems[menuId].name = newName;
                }
                // Here you would call API to save the new name
            }
        };

        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = currentName;
                input.blur();
            }
        });
    }

    setupUserMenuDropdown() {
        const menuToggle = document.getElementById('user-menu-toggle');
        const menuDropdown = document.getElementById('user-menu-dropdown');
        const menuWrapper = menuToggle ? menuToggle.closest('.user-menu-wrapper') : null;

        if (!menuToggle || !menuDropdown) return;

        // Toggle dropdown on click
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menuDropdown.style.display !== 'none';
            menuDropdown.style.display = isOpen ? 'none' : '';
            if (menuWrapper) {
                menuWrapper.classList.toggle('open', !isOpen);
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!menuToggle.contains(e.target) && !menuDropdown.contains(e.target)) {
                menuDropdown.style.display = 'none';
                if (menuWrapper) {
                    menuWrapper.classList.remove('open');
                }
            }
        });

        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.theme) {
                    this.theme.toggleTheme();
                } else {
                    // Fallback: toggle manually
                    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
                    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                    document.documentElement.setAttribute('data-theme', newTheme);
                    localStorage.setItem('theme', newTheme);
                }
                this.updateThemeLabels();
            });
        }

        // Initialize theme labels
        this.updateThemeLabels();
    }

    updateThemeLabels() {
        const themeIcon = document.getElementById('theme-icon');
        const themeValue = document.getElementById('theme-value');
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        if (themeIcon) {
            themeIcon.className = 'user-menu-icon pi ' + (isDark ? 'pi-sun' : 'pi-moon');
        }
        if (themeValue) {
            themeValue.textContent = isDark ? 'Светлая' : 'Темная';
        }
    }

    setupLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                // Delete the idb_{db} cookie for current database
                if (typeof db !== 'undefined') {
                    document.cookie = 'idb_' + db + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
                    document.cookie = db + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
                }
                // Redirect to root
                window.location.href = '/';
            });
        }
    }

    highlightActiveMenuItem() {
        // Get current action from URL or global variable
        const currentAction = typeof action !== 'undefined' ? action : '';
        const currentPath = window.location.pathname;

        const menuItems = document.querySelectorAll('.app-menu-item');
        menuItems.forEach(item => {
            // Use data-href attribute which contains the actual href value (without db prefix)
            // Skip menu items with empty href - they should not be highlighted as active
            const dataHref = item.getAttribute('data-href');
            if (!dataHref || dataHref.trim() === '') {
                return; // Skip items with empty href
            }

            // Check if this menu item matches current action or path
            const hrefParts = dataHref.split('/').filter(p => p);
            const lastPart = hrefParts[hrefParts.length - 1];

            if (currentAction && lastPart === currentAction) {
                item.classList.add('active');
            } else if (currentPath.includes(dataHref)) {
                item.classList.add('active');
            }
        });
    }

    initUserAvatar() {
        const avatar = document.getElementById('account-avatar');
        if (avatar && typeof user !== 'undefined' && user) {
            // Show first character of username
            const firstChar = user.charAt(0).toUpperCase();
            avatar.textContent = firstChar;
        }
    }
}

// Initialize main app controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for app.js to initialize
    setTimeout(() => {
        const mainApp = new MainAppController();
        mainApp.init();
    }, 50);
});
