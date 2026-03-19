/**
 * Info.html Workspace Script
 * Handles tabs (with cookie persistence), expandable action items,
 * hints mode management, and quick links loading.
 */

(function() {
    'use strict';

    var COOKIE_ACTIVE_TAB = 'info_active_tab';
    var COOKIE_HINTS_MODE = 'hints_mode';
    var COOKIE_HINTS_SEEN = 'hints_seen_workspaces';

    // ── Cookie helpers ──────────────────────────────────────────────────────

    function setCookie(name, value, days) {
        var expires = '';
        if (days) {
            var d = new Date();
            d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
            expires = '; expires=' + d.toUTCString();
        }
        document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
    }

    function getCookie(name) {
        var prefix = name + '=';
        var parts = document.cookie.split(';');
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            if (part.indexOf(prefix) === 0) {
                return decodeURIComponent(part.substring(prefix.length));
            }
        }
        return null;
    }

    // ── Tab switching ────────────────────────────────────────────────────────

    var TAB_ORDER = ['intro', 'quicklinks', 'forms'];

    function getActiveTab() {
        var saved = getCookie(COOKIE_ACTIVE_TAB);
        return (saved && TAB_ORDER.indexOf(saved) >= 0) ? saved : TAB_ORDER[0];
    }

    function renderTabs(activeTab) {
        var tabsEl = document.getElementById('info-tabs');
        if (!tabsEl) return;

        var active = activeTab || getActiveTab();

        // Update active class on existing buttons (tabs stay in their fixed positions)
        tabsEl.querySelectorAll('.info-tab').forEach(function(btn) {
            var tabId = btn.dataset.tab;
            btn.classList.toggle('active', tabId === active);
        });

        showContent(active);

        // Reveal the container once the correct tab is already shown (eliminates flicker)
        var container = tabsEl.closest('.info-tabs-container');
        if (container) {
            container.style.visibility = 'visible';
        }
    }

    function showContent(tabId) {
        ['intro', 'quicklinks', 'forms'].forEach(function(id) {
            var el = document.getElementById('content-' + id);
            if (el) el.style.display = (id === tabId) ? '' : 'none';
        });

        // Lazy-load quick links when that tab becomes visible
        if (tabId === 'quicklinks') {
            loadQuickLinks();
        }
    }

    // Exposed globally so inline onclick handlers can call it
    window.infoSwitchTab = function(tabId) {
        setCookie(COOKIE_ACTIVE_TAB, tabId, 365);
        renderTabs(tabId);
    };

    // ── Menu item hover highlight from action links ───────────────────────────

    function initActionLinkHover() {
        var links = document.querySelectorAll('.info-action-link[href]');
        links.forEach(function(link) {
            link.addEventListener('mouseenter', function() {
                highlightMenuItemForLink(link.getAttribute('href'), true);
            });
            link.addEventListener('mouseleave', function() {
                highlightMenuItemForLink(link.getAttribute('href'), false);
            });
        });
    }

    function highlightMenuItemForLink(href, on) {
        if (!href || href === '#') return;
        // Strip leading slash and db prefix (e.g. "/mydb/tables" -> "tables")
        // Menu item data-href stores the path after the db prefix
        var parts = href.replace(/^\//, '').split('/');
        // Remove the db segment (first part) to get the menu href
        var menuHref = parts.slice(1).join('/');
        if (!menuHref) return;

        var menuItems = document.querySelectorAll('.app-menu-item[data-href]');
        menuItems.forEach(function(item) {
            var itemHref = item.getAttribute('data-href') || '';
            if (itemHref === menuHref) {
                item.classList.toggle('link-hover', on);
            }
        });
    }

    // ── Expandable action items ──────────────────────────────────────────────

    function initActionItems() {
        var items = document.querySelectorAll('.info-action-item');
        items.forEach(function(item) {
            var header = item.querySelector('.info-action-header');
            if (!header) return;
            header.addEventListener('click', function() {
                item.classList.toggle('open');
            });
        });
    }

    // ── Hints mode ──────────────────────────────────────────────────────────

    window.infoHints = function(action) {
        var statusEl = document.getElementById('hints-status');

        if (action === 'enable') {
            setCookie(COOKIE_HINTS_MODE, 'on', 365);
            if (statusEl) statusEl.textContent = 'Режим подсказок включён.';
        } else if (action === 'disable') {
            setCookie(COOKIE_HINTS_MODE, 'off', 365);
            if (statusEl) statusEl.textContent = 'Режим подсказок отключён.';
        } else if (action === 'reset') {
            setCookie(COOKIE_HINTS_MODE, 'on', 365);
            setCookie(COOKIE_HINTS_SEEN, '', 365);
            if (statusEl) statusEl.textContent = 'Режим подсказок сброшен — подсказки будут показаны заново.';
        }

        // Update button states
        updateHintButtons();
    };

    function updateHintButtons() {
        var mode = getCookie(COOKIE_HINTS_MODE);
        var enableBtn = document.getElementById('hints-enable');
        var disableBtn = document.getElementById('hints-disable');
        if (!enableBtn || !disableBtn) return;

        if (mode === 'off') {
            enableBtn.style.opacity = '0.6';
            disableBtn.style.opacity = '1';
        } else {
            enableBtn.style.opacity = '1';
            disableBtn.style.opacity = '0.6';
        }
    }

    // ── Quick links ─────────────────────────────────────────────────────────

    var quickLinksLoaded = false;

    function loadQuickLinks() {
        if (quickLinksLoaded) return;
        var container = document.getElementById('quick-links');
        if (!container) return;

        fetch('/' + window.db + '/report/299?JSON_KV')
            .then(function(r) { return r.json(); })
            .then(function(links) {
                quickLinksLoaded = true;
                if (!links || links.length === 0) {
                    container.innerHTML = '<div style="padding:20px;color:var(--text-secondary)">Нет быстрых ссылок</div>';
                    return;
                }
                var html = '';
                links.forEach(function(link) {
                    var format = link['Формат отчета'] || 'report';
                    var queryId = link['ЗапросID'];
                    var label = link['Запрос'] || 'Ссылка';
                    var isPriority = link['приоритет'] === 'X';
                    var url = '/' + window.db + '/' + format + '/' + queryId;
                    html += '<a href="' + url + '" class="quick-link-badge' + (isPriority ? ' priority' : '') + '" target="' + queryId + '">' +
                        (isPriority ? '<span class="icon"><i class="pi pi-bolt"></i></span>' : '') +
                        label + '</a>';
                });
                container.innerHTML = html;
            })
            .catch(function(err) {
                console.error('Error loading quick links:', err);
                container.innerHTML = '<div style="padding:20px;color:var(--color-error)">Ошибка загрузки быстрых ссылок</div>';
            });
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function initTabClickHandlers() {
        var tabsEl = document.getElementById('info-tabs');
        if (!tabsEl) return;
        tabsEl.querySelectorAll('.info-tab').forEach(function(btn) {
            var tabId = btn.dataset.tab;
            btn.addEventListener('click', function() {
                infoSwitchTab(tabId);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        initTabClickHandlers();
        renderTabs();
        initActionItems();
        updateHintButtons();
        initActionLinkHover();
    });

})();
