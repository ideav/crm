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

    var TAB_ORDER_DEFAULT = ['intro', 'quicklinks', 'forms'];

    function getTabOrder() {
        var saved = getCookie(COOKIE_ACTIVE_TAB);
        if (!saved) return TAB_ORDER_DEFAULT.slice();
        // Saved value is the last-active tab name; move it to front
        var order = TAB_ORDER_DEFAULT.slice();
        var idx = order.indexOf(saved);
        if (idx > 0) {
            order.splice(idx, 1);
            order.unshift(saved);
        }
        return order;
    }

    function renderTabs(activeTab) {
        var tabsEl = document.getElementById('info-tabs');
        if (!tabsEl) return;

        var order = getTabOrder();
        // If caller specifies activeTab, move it to front
        if (activeTab) {
            var idx = order.indexOf(activeTab);
            if (idx > 0) {
                order.splice(idx, 1);
                order.unshift(activeTab);
            }
        }

        var labels = { intro: 'Вводная', quicklinks: 'Быстрые ссылки', forms: 'Формы и отчеты' };

        tabsEl.innerHTML = '';
        order.forEach(function(tabId, i) {
            var btn = document.createElement('button');
            btn.className = 'info-tab' + (i === 0 ? ' active' : '');
            btn.id = 'tab-' + tabId;
            btn.dataset.tab = tabId;
            btn.textContent = labels[tabId] || tabId;
            btn.addEventListener('click', function() {
                infoSwitchTab(tabId);
            });
            tabsEl.appendChild(btn);
        });

        // Show first tab content
        showContent(order[0]);
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

    document.addEventListener('DOMContentLoaded', function() {
        renderTabs();
        initActionItems();
        updateHintButtons();
    });

})();
