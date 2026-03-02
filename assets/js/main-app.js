// ============================================================
// Main Application Controller
// ============================================================

class MainAppController {
    constructor() {
        this.i18n = window._app ? window._app.i18n : null;
        this.theme = window._app ? window._app.theme : null;
    }

    init() {
        this.setupSidebarToggle();
        this.setupUserMenuDropdown();
        this.setupLogout();
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
