/*
 * Счётчик времени активности в пультах оператора atex (ideav/crm#4682).
 *
 * Пульты слиттера, втулкореза и упаковки живут на общем цеховом планшете: человек
 * вошёл под своим логином, отработал и ушёл, не выходя. Кука с токеном живёт год
 * (`index.php`, `setcookie("idb_$z", …, time() + 2592000*12)`), поэтому следующий,
 * кто возьмёт планшет, продолжит работать под чужим именем.
 *
 * Модуль включает отсчёт при входе в пульт, сбрасывает его на каждое действие
 * человека и через IDLE_MS БЕЗ ДЕЙСТВИЙ снимает куку с токеном и уводит на форму
 * входа `/start.html` — то же самое, что делает кнопка «Выйти» верхнего меню
 * (`js/main-app.js`, `setupLogout`).
 *
 * Подключается в шаблоне пульта отдельным тегом, рядом со сторожем планшета:
 *
 *   <script src="/download/{db}/js/idle-logout.js?…"
 *           data-idle-root="atex-slitter" defer></script>
 *
 * Настройки берутся с корневого элемента пульта (`data-db`, `data-user`) — те же,
 * что читает `pad-guard.js`. Атрибут `data-idle-minutes` на корне укорачивает срок
 * для приёмки (ждать три часа руками нечем); удлинить им срок нельзя.
 *
 * Отсчёт лежит в localStorage, а не в памяти страницы: так он переживает
 * перезагрузку пульта и общий у соседних вкладок — работа в одной не даёт выкинуть
 * из другой. Ключ снимается в момент выхода, иначе протухший отсчёт выкидывал бы
 * человека сразу после нового входа.
 *
 * Чистая часть и ядро счётчика экспортируются через module.exports для тестов
 * (experiments/atex-idle-logout.test.js).
 */
(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AtexIdleLogout = api;
        if (root.document) api.boot(root.document.currentScript);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
    'use strict';

    var IDLE_MINUTES = 180;                 // 3 часа — требование #4682
    var IDLE_MS = IDLE_MINUTES * 60 * 1000;
    var TICK_MS = 30 * 1000;                // с какой частотой сверяемся со сроком
    var WRITE_MS = 5 * 1000;                // не чаще этого пишем отсчёт в хранилище
    var STORAGE_PREFIX = 'atehIdle_';

    // Действия человека, сбрасывающие отсчёт. `input` нужен отдельно от `keydown`:
    // экранная клавиатура планшета не всегда шлёт клавиши.
    var ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'input', 'wheel', 'scroll'];

    // ── Чистые функции ──

    function storageKey(db) {
        return STORAGE_PREFIX + String(db == null ? '' : db);
    }

    // Срок из `data-idle-minutes`: только целые минуты от 1 до IDLE_MINUTES.
    // Всё остальное (пусто, мусор, ноль, отрицательное, больше срока) — 3 часа.
    function idleMsFromAttr(value) {
        var minutes = parseInt(String(value == null ? '' : value).trim(), 10);
        if (!isFinite(minutes) || minutes < 1 || minutes > IDLE_MINUTES) return IDLE_MS;
        return minutes * 60 * 1000;
    }

    // Оболочка рабочего места (`js/main-app.js`) — источник истины для выхода:
    // те же куки и тот же адрес формы входа, что и у кнопки «Выйти».
    function shell() {
        try {
            return (typeof MainAppController !== 'undefined') ? MainAppController : null;
        } catch (e) {
            return null;
        }
    }

    // Запасной путь на случай, если оболочка не загрузилась: пульт с живым токеном
    // после трёх часов простоя — ровно то, что задача запрещает, так что выход
    // должен состояться и без неё.
    function logoutUrl(db, user) {
        var app = shell();
        if (app && typeof app.getLogoutStartUrl === 'function') return app.getLogoutStartUrl(db, user);
        var params = new root.URLSearchParams();
        params.set('db', db || '');
        if (user) params.set('u', user);
        return '/start.html?' + params.toString();
    }

    function cookieClearStrings(db) {
        var dead = '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
        return ['idb_' + db + dead, db + dead];
    }

    // ── Хранилище (тихое: приватный режим не должен ломать пульт) ──

    // Само обращение к `localStorage` бросает SecurityError, когда браузеру
    // запрещены данные сайта, — поэтому и оно под try.
    function safeStorage() {
        try { return root.localStorage || null; }
        catch (e) { return null; }
    }

    function readStamp(storage, key) {
        try {
            var raw = storage && storage.getItem(key);
            var value = parseInt(raw, 10);
            return isFinite(value) ? value : null;
        } catch (e) {
            return null;
        }
    }

    function writeStamp(storage, key, value) {
        try { storage.setItem(key, String(value)); } catch (e) { /* приватный режим */ }
    }

    function dropStamp(storage, key) {
        try { storage.removeItem(key); } catch (e) { /* приватный режим */ }
    }

    // ── Ядро счётчика ──
    //
    // Часы приходят снаружи (`touch(now)`, `check(now)`) — так счётчик проверяется
    // без ожидания и без подмены таймеров.
    function createWatch(opts) {
        var idleMs = opts.idleMs || IDLE_MS;
        var storage = opts.storage;
        var key = opts.key;
        var onExpire = opts.onExpire;
        var last = null;        // отсчёт этой страницы
        var written = 0;        // когда в последний раз писали в хранилище
        var expired = false;

        // Последнее действие: своё или соседней вкладки — что было позже.
        function lastActivity() {
            var stored = readStamp(storage, key);
            if (last == null) return stored;
            if (stored == null) return last;
            return Math.max(last, stored);
        }

        function touch(now) {
            if (expired) return;
            last = now;
            if (now - written >= WRITE_MS) {
                written = now;
                writeStamp(storage, key, now);
            }
        }

        function check(now) {
            if (expired) return true;
            var mark = lastActivity();
            if (mark == null || now - mark < idleMs) return false;
            expired = true;
            // Ключ снимаем ДО выхода: иначе следующий вход в пульт прочитает
            // протухший отсчёт и выкинет человека сразу.
            dropStamp(storage, key);
            if (typeof onExpire === 'function') onExpire();
            return true;
        }

        return {
            touch: touch,
            check: check,
            lastActivity: lastActivity,
            isExpired: function() { return expired; }
        };
    }

    // ── Загрузка в окне ──

    function nowMs() {
        return (root.Date || Date).now();
    }

    function logout(db, user) {
        var app = shell();
        if (app && typeof app.deleteCurrentDbCookies === 'function') {
            app.deleteCurrentDbCookies(db);
        } else {
            cookieClearStrings(db).forEach(function(item) { root.document.cookie = item; });
        }
        // `replace`, а не `href`: возврат «назад» на пульт без токена — пустой экран.
        var url = logoutUrl(db, user);
        if (root.location && typeof root.location.replace === 'function') root.location.replace(url);
        else root.location.href = url;
    }

    function boot(currentScript) {
        var script = currentScript || (root.document && root.document.currentScript);
        if (!script) return null;
        var rootId = script.getAttribute('data-idle-root');
        var container = rootId ? root.document.getElementById(rootId) : null;
        if (!container) return null;

        var db = container.getAttribute('data-db') || '';
        var user = container.getAttribute('data-user') || '';
        var idleMs = idleMsFromAttr(container.getAttribute('data-idle-minutes'));
        var timer = null;
        var listeners = [];

        var watch = createWatch({
            idleMs: idleMs,
            storage: safeStorage(),
            key: storageKey(db),
            onExpire: function() {
                stop();
                logout(db, user);
            }
        });

        function stop() {
            if (timer != null && typeof root.clearInterval === 'function') root.clearInterval(timer);
            timer = null;
            listeners.forEach(function(item) {
                root.document.removeEventListener(item.type, item.fn, item.opts);
            });
            listeners = [];
        }

        // Отсчёт прошлой сессии страницы старше срока — бездействие уже случилось,
        // и открытие пульта его не отменяет.
        if (watch.check(nowMs())) return watch;

        // Человек зашёл в пульт — счётчик включается.
        watch.touch(nowMs());

        var onActivity = function() { watch.touch(nowMs()); };
        var opts = { capture: true, passive: true };
        ACTIVITY_EVENTS.forEach(function(type) {
            root.document.addEventListener(type, onActivity, opts);
            listeners.push({ type: type, fn: onActivity, opts: opts });
        });
        timer = root.setInterval(function() { watch.check(nowMs()); }, TICK_MS);

        return watch;
    }

    return {
        IDLE_MINUTES: IDLE_MINUTES,
        IDLE_MS: IDLE_MS,
        TICK_MS: TICK_MS,
        WRITE_MS: WRITE_MS,
        STORAGE_PREFIX: STORAGE_PREFIX,
        ACTIVITY_EVENTS: ACTIVITY_EVENTS,
        storageKey: storageKey,
        idleMsFromAttr: idleMsFromAttr,
        logoutUrl: logoutUrl,
        cookieClearStrings: cookieClearStrings,
        createWatch: createWatch,
        boot: boot
    };
});
