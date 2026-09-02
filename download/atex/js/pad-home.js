/*
 * Вход оператора в СВОЁ рабочее место с планшета (ideav/crm#4789).
 *
 * Планшет цеха настроен на одно рабочее место оператора: в таблице «Планшет»
 * (см. pad-guard.js, #4666) у записи устройства заполнена одна из колонок
 * «Слиттер» / «Втулкорез» / «Упаковочное место», а «Рабочее место» называет пульт
 * прямо. Оператор входит под своим логином и должен сразу оказаться в этом пульте —
 * без меню и без выбора.
 *
 * Модуль подключается в `templates/atex/main.html` и работает только тогда, когда
 * выполнены оба условия:
 *   • роль вошедшего перечислена в `data-pad-roles` (роль оператора, id 1621);
 *   • открыт КОРЕНЬ базы (`action` пуст) — внутренние страницы редиректом не
 *     перебиваем, иначе из открытой карточки не выйти (та же осторожность, что у
 *     единственного пункта меню, #4690).
 *
 * Настройки не хватает — показываем экран «Рабочее место не настроено» и КОД
 * УСТРОЙСТВА: диспетчер вписывает его в первую колонку «Планшета» и заполняет
 * станок/втулкорез/место. Код берётся из localStorage, а если его там ещё нет —
 * генерируется и запоминается (pad-guard.ensureToken), иначе показанный код не
 * совпал бы с тем, с которым устройство придёт в следующий раз.
 *
 * Чистая часть (разбор ролей, решение «куда вести») экспортируется через
 * module.exports для тестов (experiments/atex-pad-home.test.js).
 */
(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AtexPadHome = api;
        if (root.document) api.boot(root.document.currentScript);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
    'use strict';

    var TABLE_NAME = 'Планшет';

    function trimText(value) {
        return String(value == null ? '' : value).trim();
    }

    // «1621, 1622» / «1621 1622» → ['1621','1622'].
    function parseRoles(value) {
        return trimText(value).split(/[\s,;]+/).map(trimText).filter(Boolean);
    }

    // #4852: роль из списка уводим в пульт планшета с ЛЮБОЙ страницы базы — оператору
    // нельзя быть нигде, кроме своего рабочего места (прошлее правило «только с корня»
    // оставляло ему внутренние страницы). Цикл гасит проверка «уже на месте» в boot:
    // когда пульт планшета совпадает с открытой страницей, экран убирается и ничего
    // не перезагружается.
    function shouldRedirect(ctx) {
        if (!ctx) return false;
        var roles = ctx.roles || [];
        return roles.indexOf(trimText(ctx.roleId)) !== -1;
    }

    // Адрес рабочего места планшета: `/{db}/{action}`.
    function workspaceUrl(db, action) {
        return '/' + encodeURIComponent(trimText(db)) + '/' + trimText(action);
    }

    // #4852: открытая страница — и есть пульт этого планшета → остаёмся (иначе цикл
    // «страница → редирект → страница»). target — то, что вернул guard.padWorkspace.
    function stayOnTarget(target, action) {
        return !!target && target.ok === true && trimText(action) === trimText(target.action);
    }

    // Чего не хватает для однозначного выбора — человеческим языком.
    function reasonText(reason) {
        if (reason === 'ambiguous')
            return 'В записи планшета заполнено несколько объектов сразу (станок, втулкорез, упаковочное место). '
                + 'Оставьте один или назовите рабочее место в колонке «Рабочее место».';
        if (reason === 'no-pad')
            return 'Это устройство не значится в таблице «' + TABLE_NAME + '».';
        return 'В записи планшета не заполнены ни станок, ни втулкорез, ни упаковочное место.';
    }

    // ── DOM ──

    function el(tag, attrs, children) {
        var node = root.document.createElement(tag);
        Object.keys(attrs || {}).forEach(function(k) {
            if (attrs[k] === undefined || attrs[k] === null) return;
            if (k === 'text') node.textContent = attrs[k];
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(child) { if (child) node.appendChild(child); });
        return node;
    }

    // Стили экрана живут в atex-brand.css, а на корне базы он не подключён (его тянут
    // сами рабочие места) — подключаем сами, адрес с версией даёт шаблон.
    function ensureStyles(href) {
        if (!href || root.document.getElementById('atex-pad-home-css')) return;
        var link = root.document.createElement('link');
        link.id = 'atex-pad-home-css';
        link.rel = 'stylesheet';
        link.href = href;
        root.document.head.appendChild(link);
    }

    // Экран поверх страницы: пока идёт проверка — «Открываем рабочее место…», потом
    // либо переход, либо объяснение, почему перехода нет.
    function showScreen(title, text, token) {
        var host = root.document.body;
        if (!host) return null;
        var prev = root.document.getElementById('atex-pad-home');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        var card = el('div', { class: 'atex-pad-card' }, [
            el('h2', { class: 'atex-pad-title', text: title }),
            text ? el('p', { class: 'atex-pad-text', text: text }) : null
        ]);
        if (token) {
            card.appendChild(el('div', { class: 'atex-pad-label',
                text: 'Код этого планшета (первая колонка таблицы «' + TABLE_NAME + '»)' }));
            card.appendChild(el('div', { class: 'atex-pad-token', text: token }));
        }
        var screen = el('div', { class: 'atex-pad-guard atex-brand', id: 'atex-pad-home' }, [card]);
        host.appendChild(screen);
        return screen;
    }

    function hideScreen() {
        var prev = root.document.getElementById('atex-pad-home');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    }

    // ── Работа с сервером (тот же путь, что у сторожа планшета) ──

    function url(ctx, path) {
        return '/' + encodeURIComponent(ctx.db) + '/' + path;
    }

    function getJson(ctx, path) {
        return root.fetch(url(ctx, path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); }
                catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                var guard = root.AtexPadGuard;
                var message = guard && guard.apiError ? guard.apiError(resp, data) : '';
                if (message) throw new Error(message);
                return data;
            });
        });
    }

    // Планшет по токену устройства: та же таблица и тот же фильтр, что у сторожа.
    function loadPad(ctx, guard, token) {
        return getJson(ctx, 'metadata').then(function(metadata) {
            var table = guard.findTable(metadata);
            if (!table) throw new Error('В базе нет таблицы «' + TABLE_NAME + '»');
            return getJson(ctx, guard.buildLookupPath(table.id, token)).then(function(rows) {
                return { table: table, pad: guard.padFromRows(rows, token, guard.nameColIndex(table), table) };
            });
        });
    }

    function boot(currentScript) {
        var script = currentScript || (root.document && root.document.currentScript);
        if (!script) return;
        var ctx = {
            db: script.getAttribute('data-pad-db') || root.db || '',
            action: script.getAttribute('data-pad-action') || root.action || '',
            roleId: script.getAttribute('data-pad-role-id') || root.roleId || '',
            roles: parseRoles(script.getAttribute('data-pad-roles')),
            css: script.getAttribute('data-pad-css') || ''
        };
        if (!shouldRedirect(ctx)) return;
        ensureStyles(ctx.css);
        var guard = root.AtexPadGuard;
        if (!guard) return;   // сторож не загружен — вести некуда, оставляем обычную страницу

        var token = guard.readToken(root.localStorage);
        showScreen('Открываем рабочее место…', '', '');
        if (!guard.isToken(token)) {
            showScreen('Рабочее место не настроено', reasonText('no-pad'),
                guard.ensureToken(root.localStorage, root.crypto));
            return;
        }

        loadPad(ctx, guard, token).then(function(res) {
            if (!res.pad) {
                showScreen('Рабочее место не настроено', reasonText('no-pad'),
                    guard.ensureToken(root.localStorage, root.crypto));
                return;
            }
            var target = guard.padWorkspace(res.pad);
            if (!target.ok) {
                showScreen('Рабочее место не настроено',
                    'Планшет «' + (res.pad.name || res.pad.token) + '»: ' + reasonText(target.reason), token);
                return;
            }
            // #4852: открытая страница и есть пульт этого планшета — остаёмся здесь,
            // ничего не перезагружаем (иначе цикл «страница → редирект → страница»).
            if (stayOnTarget(target, ctx.action)) {
                hideScreen();
                return;
            }
            root.location.replace(workspaceUrl(ctx.db, target.action));
        }).catch(function(err) {
            // Молча оставлять оператора на пустом корне нельзя — говорим, что случилось.
            hideScreen();
            showScreen('Рабочее место не открылось', err && err.message ? err.message : String(err), token);
        });
    }

    return {
        TABLE_NAME: TABLE_NAME,
        parseRoles: parseRoles,
        shouldRedirect: shouldRedirect,
        stayOnTarget: stayOnTarget,     // #4852: открытая страница — свой пульт, не перезагружаем
        workspaceUrl: workspaceUrl,
        reasonText: reasonText,
        boot: boot
    };
});
