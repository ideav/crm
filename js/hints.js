/**
 * hints.js — общий механизм отображения подсказок для рабочих мест.
 *
 * Использование:
 *   1. Подключить этот скрипт на странице рабочего места.
 *   2. Разместить HTML-структуру подсказок (hint-box, hint-mobile-toggle) в шаблоне.
 *   3. Вызвать window.initHints(config) после DOMContentLoaded, передав конфигурацию рабочего места.
 *
 * Конфигурация (config):
 *   workspace   {string}   — идентификатор рабочего места (например, 'upload').
 *   steps       {number}   — количество шагов подсказки.
 *   onInit      {function} — (необязательно) callback после инициализации, принимает объект API подсказок.
 *                            Используйте для привязки специфичных для рабочего места триггеров.
 *
 * API объекта подсказок (передаётся в onInit и доступен через window[workspace + 'Hint']):
 *   show(n)    — показать шаг n (число от 1 до steps).
 *   close()    — закрыть окно подсказки и сохранить в cookies.
 *   advance(n) — перейти к шагу n, если окно сейчас открыто.
 */
(function() {
    'use strict';

    // Hints state (hints_mode, hints_seen_workspaces) is kept in localStorage,
    // not cookies, so it is not sent to the server on every request. A legacy
    // cookie of the same name is migrated on first read and then deleted.
    function getCookie(name) {
        var legacy = null;
        var prefix = name + '=';
        var parts = document.cookie ? document.cookie.split(';') : [];
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            if (part.indexOf(prefix) === 0) { legacy = decodeURIComponent(part.substring(prefix.length)); break; }
        }
        try {
            if (legacy !== null) {
                if (localStorage.getItem(name) === null && legacy !== '') localStorage.setItem(name, legacy);
                document.cookie = name + '=; path=/; max-age=0';
            }
            return localStorage.getItem(name);
        } catch (e) {
            return legacy;
        }
    }

    function setCookie(name, value) {
        try {
            localStorage.setItem(name, value);
            if (document.cookie.indexOf(name + '=') !== -1) document.cookie = name + '=; path=/; max-age=0';
        } catch (e) {
            document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000';
        }
    }

    /**
     * Инициализировать механизм подсказок для рабочего места.
     * @param {Object} config
     * @param {string} config.workspace  — идентификатор рабочего места
     * @param {number} config.steps      — количество шагов
     * @param {function} [config.onInit] — callback(api), вызывается после инициализации
     */
    window.initHints = function(config) {
        if (!(window.user && window.db && window.user === window.db)) return;
        var workspace = config.workspace;
        var steps = config.steps;

        var hintBox = document.getElementById(workspace + '-hint-box');
        if (!hintBox) return;

        var hintAtTop = false;

        var api = {
            show: function(n) {
                if (getCookie('hints_mode') === 'off') return;
                for (var i = 1; i <= steps; i++) {
                    var el = document.getElementById(workspace + '-hint-' + i);
                    if (el) el.style.display = (i === n) ? '' : 'none';
                }
                hintBox.style.display = 'block';
                var tog = document.getElementById(workspace + '-hint-mobile-toggle');
                if (tog) tog.innerHTML = hintAtTop ? '&#8595;' : '&#8593;';
            },

            close: function() {
                hintBox.style.display = 'none';
                var tog = document.getElementById(workspace + '-hint-mobile-toggle');
                if (tog) tog.style.display = 'none';
                var seen = getCookie('hints_seen_workspaces') || '';
                var list = seen ? seen.split(',') : [];
                if (list.indexOf(workspace) === -1) {
                    list.push(workspace);
                    setCookie('hints_seen_workspaces', list.join(','), 365);
                }
            },

            advance: function(toStep) {
                if (hintBox.style.display === 'none') return;
                api.show(toStep);
            }
        };

        // Expose API on window for inline onclick handlers, e.g. window.uploadHintClose()
        var prefix = workspace.charAt(0).toUpperCase() + workspace.slice(1);
        window[workspace + 'HintShow'] = api.show;
        window[workspace + 'HintClose'] = api.close;
        window[workspace + 'HintAdvance'] = api.advance;
        // Also expose as camelCase alias: window.uploadHint
        window[workspace + 'Hint'] = api;

        // Dragging support (desktop)
        var handle = document.getElementById(workspace + '-hint-drag-handle');
        if (handle) {
            var dragging = false, startX, startY, origLeft, origTop;
            handle.addEventListener('mousedown', function(e) {
                dragging = true;
                startX = e.clientX;
                startY = e.clientY;
                var rect = hintBox.getBoundingClientRect();
                origLeft = rect.left;
                origTop = rect.top;
                hintBox.style.transform = 'none';
                hintBox.style.top = origTop + 'px';
                hintBox.style.left = origLeft + 'px';
                e.preventDefault();
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                var dx = e.clientX - startX;
                var dy = e.clientY - startY;
                var newLeft = origLeft + dx;
                var newTop = origTop + dy;
                var maxLeft = window.innerWidth - hintBox.offsetWidth;
                var maxTop = window.innerHeight - hintBox.offsetHeight;
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));
                hintBox.style.left = newLeft + 'px';
                hintBox.style.top = newTop + 'px';
            });
            document.addEventListener('mouseup', function() { dragging = false; });
        }

        // Mobile toggle: snap hint to top or bottom
        var mobileToggle = document.getElementById(workspace + '-hint-mobile-toggle');
        if (mobileToggle) {
            mobileToggle.innerHTML = '&#8593;';
            mobileToggle.addEventListener('click', function() {
                hintAtTop = !hintAtTop;
                hintBox.style.transform = 'none';
                hintBox.style.left = '50%';
                hintBox.style.top = hintAtTop ? '1rem' : 'auto';
                hintBox.style.bottom = hintAtTop ? 'auto' : '1.5rem';
                hintBox.style.marginLeft = '-' + (hintBox.offsetWidth / 2) + 'px';
                mobileToggle.style.top = hintAtTop ? 'auto' : '5rem';
                mobileToggle.style.bottom = hintAtTop ? '1rem' : 'auto';
                mobileToggle.innerHTML = hintAtTop ? '&#8595;' : '&#8593;';
            });
        }

        // Check cookies and show first hint if not seen
        var mode = getCookie('hints_mode');
        if (mode === 'off') {
            var togOff = document.getElementById(workspace + '-hint-mobile-toggle');
            if (togOff) togOff.style.display = 'none';
            return;
        }
        var seen = getCookie('hints_seen_workspaces') || '';
        var list = seen ? seen.split(',') : [];
        if (list.indexOf(workspace) !== -1) {
            var togSeen = document.getElementById(workspace + '-hint-mobile-toggle');
            if (togSeen) togSeen.style.display = 'none';
            return;
        }

        // Run workspace-specific initialization (bind triggers, etc.)
        if (typeof config.onInit === 'function') {
            config.onInit(api);
        }

        api.show(1);
    };
})();
