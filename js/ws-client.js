/**
 * Клиент web-socket Интеграма (issue #5269). Описание — docs/kb/realtime.md.
 *
 * Одно соединение на страницу с демоном ws-server/. Адрес — переменная шаблона
 * {_global_.ws} (INTEGRAM_WS_PUBLIC_URL ядра); пустой адрес — клиент выключен.
 *
 *   IntegramWS.subscribe(typeId, fn) → off()   fn({by, rows, remove, added, stale}) — изменения таблицы
 *     off.shown([id…])                         записи этой таблицы на экране — демон шлёт их правки
 *   IntegramWS.onNotify(fn) → off()            fn({from, data:{msg, link}}) — уведомления
 *
 * rows — новые значения записей на экране ({i,u,o,r}, как object/?JSON_OBJ), remove — записи,
 * которые надо убрать с экрана (удалены или скрыты маской), added — родители (u) новых видимых
 * записей (счётчик плашки), stale — "schema" | "bulk" | "lost": данные устарели, перечитать по
 * кнопке. После обрыва — stale:"lost" (изменения за время обрыва потеряны). Вход отозван (код
 * 4401) — без переподключения.
 */
(function (root) {
    'use strict';

    const RETRY_MIN_MS = 1000;
    const RETRY_MAX_MS = 30000;

    class WsClient {
        constructor(opts) {
            this.opts = opts || {};
            this.subs = new Map();          // typeId → Set<{fn, shown}>
            this.notifyFns = new Set();
            this.ws = null;
            this.opened = false;            // соединение уже открывалось — следующее открытие после обрыва
            this.retryMs = RETRY_MIN_MS;
            this.stopped = false;
        }

        enabled() {
            return !!(this.opts.url && this.opts.db && this.opts.WebSocket);
        }

        address() {
            let url = String(this.opts.url);
            if (url.charAt(0) === '/') {
                const loc = this.opts.location || {};
                url = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + url;
            }
            return url + (url.indexOf('?') < 0 ? '?' : '&') + 'db=' + encodeURIComponent(this.opts.db);
        }

        subscribe(typeId, fn) {
            const t = Number(typeId);
            if (!this.enabled() || !Number.isInteger(t) || t <= 0) {
                const noop = function () {};
                noop.shown = function () {};
                return noop;
            }
            let set = this.subs.get(t);
            const entry = { fn: fn, shown: [] };
            if (!set) {
                set = new Set();
                this.subs.set(t, set);
                set.add(entry);
                this.sendIfOpen({ op: 'sub', t: t, shown: [] });
            } else set.add(entry);
            this.connect();
            const off = () => {
                set.delete(entry);
                if (!set.size && this.subs.get(t) === set) {
                    this.subs.delete(t);
                    this.sendIfOpen({ op: 'unsub', t: t });
                } else if (this.subs.get(t) === set) this.sendIfOpen({ op: 'shown', t: t, ids: this.shownOf(t) });
            };
            off.shown = (ids) => {
                entry.shown = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
                if (this.subs.get(t) === set) this.sendIfOpen({ op: 'shown', t: t, ids: this.shownOf(t) });
            };
            return off;
        }

        // Записи на экране всех таблиц типа t на странице
        shownOf(t) {
            const out = new Set();
            (this.subs.get(t) || []).forEach((e) => e.shown.forEach((id) => out.add(id)));
            return Array.from(out);
        }

        onNotify(fn) {
            if (!this.enabled()) return function () {};
            this.notifyFns.add(fn);
            this.connect();
            return () => this.notifyFns.delete(fn);
        }

        sendIfOpen(obj) {
            if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
        }

        connect() {
            if (this.ws || this.stopped || !this.enabled()) return;
            const ws = new this.opts.WebSocket(this.address());
            this.ws = ws;
            ws.onopen = () => {
                this.retryMs = RETRY_MIN_MS;
                this.subs.forEach((set, t) => ws.send(JSON.stringify({ op: 'sub', t: t, shown: this.shownOf(t) })));
                if (this.opened) this.dispatchAll({ by: '', rows: [], remove: [], added: [], stale: 'lost' });
                this.opened = true;
            };
            ws.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch (err) { return; }
                if (msg && msg.op === 'rows') this.dispatch(msg);
                else if (msg && msg.op === 'notify') this.notifyFns.forEach((fn) => this.safe(fn, { from: msg.from, data: msg.data }));
            };
            ws.onclose = (e) => {
                if (this.ws !== ws) return;
                this.ws = null;
                if (e && e.code === 4401) { this.stopped = true; return; }
                const delay = this.retryMs;
                this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
                (this.opts.setTimeout || setTimeout)(() => this.connect(), delay + Math.floor(delay * 0.2 * (this.opts.jitter || 0)));
            };
            ws.onerror = function () {};
        }

        // Изменения таблицы t — её подписчикам
        dispatch(msg) {
            const set = this.subs.get(Number(msg.t));
            if (!set) return;
            const out = { by: msg.by || '', rows: msg.rows || [], remove: msg.remove || [], added: msg.added || [], stale: msg.stale || '' };
            set.forEach((e) => this.safe(e.fn, out));
        }

        dispatchAll(out) {
            this.subs.forEach((set) => set.forEach((e) => this.safe(e.fn, out)));
        }

        safe(fn, arg) {
            try { fn(arg); } catch (e) { if (root.console) root.console.error('IntegramWS:', e); }
        }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { WsClient: WsClient };
    if (typeof root.window === 'undefined') return;

    // Страница: адрес и база — из main.html (window.wsUrl, window.db)
    const client = new WsClient({ url: root.wsUrl || '', db: root.db || '', WebSocket: root.WebSocket,
        location: root.location, jitter: Math.random() });
    root.IntegramWS = {
        enabled: () => client.enabled(),
        subscribe: (t, fn) => client.subscribe(t, fn),
        onNotify: (fn) => client.onNotify(fn),
    };
    // Уведомления по умолчанию — всплывающим сообщением страницы (js/app.js showToast)
    if (client.enabled() && typeof root.showToast === 'function') {
        client.onNotify((n) => {
            const text = (n.from ? n.from + ': ' : '') + (n.data && n.data.msg ? n.data.msg : '');
            if (text) root.showToast(text, 'info');
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
