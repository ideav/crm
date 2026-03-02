// ============================================================
// Main Application Controller
// ============================================================

class MainAppController {
    constructor() {
        this.i18n = window._app ? window._app.i18n : null;
        this.theme = window._app ? window._app.theme : null;
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

        // Build map of menu items by menu_id
        const itemMap = {};
        menuData.forEach(item => {
            if (item.menu_id) {
                itemMap[item.menu_id] = item;
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
        const renderItems = (items, level) => {
            const fragment = document.createDocumentFragment();
            items.forEach(item => {
                const hasChildren = children[item.menu_id] && children[item.menu_id].length > 0;
                const menuItem = this.createMenuItem(item, level, hasChildren);
                fragment.appendChild(menuItem);

                if (hasChildren) {
                    const submenu = document.createElement('div');
                    submenu.className = 'app-submenu';
                    submenu.setAttribute('data-parent', item.menu_id);
                    submenu.appendChild(renderItems(children[item.menu_id], level + 1));
                    fragment.appendChild(submenu);
                }
            });
            return fragment;
        };

        menuContainer.appendChild(renderItems(topLevel, 0));
    }

    createMenuItem(item, level, hasChildren) {
        const dbName = typeof db !== 'undefined' ? db : '';
        const href = item.href || '';

        const menuItem = document.createElement(hasChildren && !href ? 'button' : 'a');
        menuItem.className = 'app-menu-item';
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

        // Expand/collapse arrow for parent items
        if (hasChildren) {
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'menu-arrow';
            arrowSpan.innerHTML = '&#9660;'; // down arrow
            menuItem.appendChild(arrowSpan);

            menuItem.addEventListener('click', (e) => {
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

        return menuItem;
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
            themeIcon.innerHTML = isDark ? '&#9728;' : '&#127769;'; // Sun or Moon
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
            const href = item.getAttribute('data-href') || item.getAttribute('href');
            if (href) {
                // Check if this menu item matches current action or path
                const hrefParts = href.split('/').filter(p => p);
                const lastPart = hrefParts[hrefParts.length - 1];

                if (currentAction && lastPart === currentAction) {
                    item.classList.add('active');
                } else if (currentPath.includes(href)) {
                    item.classList.add('active');
                }
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
