// Рабочее место админа в ЛК базы my (#5420): то, что templates/main.html делает в head до
// отрисовки body, — размер шрифта, вид и раскладка меню (AppView), ширина левого меню.
(function () {
    'use strict';
    var FONT_COOKIE = 'integram-table-font-settings';
    var SIZE_MAP = { smaller: '.7rem', normal: '.82rem', larger: '.95rem' };

    function cookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    function fontSize() {
        try { return JSON.parse(cookie(FONT_COOKIE) || '{}').pageFontSize || 'normal'; } catch (e) { return 'normal'; }
    }

    function applyFont(size) {
        document.documentElement.style.fontSize = SIZE_MAP[size] || SIZE_MAP.normal;
    }
    applyFont(fontSize());

    window.setPageFontSize = function (size) {
        document.cookie = FONT_COOKIE + '=' + encodeURIComponent(JSON.stringify({ pageFontSize: size })) + '; path=/; max-age=31536000';
        applyFont(size);
        document.querySelectorAll('.navbar-font-size-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.size === size);
        });
    };
    document.addEventListener('DOMContentLoaded', function () {
        var current = fontSize();
        document.querySelectorAll('.navbar-font-size-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.size === current);
        });
    });

    if (window.AppView)
        window.AppView.apply(document.documentElement,
            { db: window.db, user: window.user, role: window.role, roleId: window.roleId, grants: window.grants },
            window.menuData || [], 'left');

    // Ширина и свёрнутость левого меню — до отрисовки, иначе меню прыгает (как в templates/main.html)
    var dbName = window.db || 'default';
    var savedWidth = null;
    try { savedWidth = localStorage.getItem('sidebarWidth_' + dbName); } catch (e) { /* ignore */ }
    if (savedWidth === null) savedWidth = cookie('sidebarWidth_' + dbName);
    var collapsed = false;
    try { collapsed = localStorage.getItem('appSidebarCollapsed_' + dbName) === 'true'; } catch (e) { /* ignore */ }
    var rules = '.app-sidebar{transition:none!important;}';
    if (collapsed) rules += '.app-sidebar{width:56px!important;}';
    else if (savedWidth) rules += '.app-sidebar{width:' + parseInt(savedWidth, 10) + 'px!important;}';
    var style = document.createElement('style');
    style.id = 'sidebar-init-style';
    style.textContent = rules;
    document.head.appendChild(style);
})();
