/**
 * Клиент web-socket Интеграма (issue #5269). Описание — docs/kb/realtime.md.
 *
 * Одно соединение на страницу с демоном ws-server/. Адрес — переменная шаблона
 * {_global_.ws} (INTEGRAM_WS_PUBLIC_URL ядра); пустой адрес — клиент выключен.
 *
 *   IntegramWS.subscribe(typeId, fn) → off()   fn({by, reload, events}) — события таблицы
 *   IntegramWS.onNotify(fn) → off()            fn({from, data:{msg, link}}) — уведомления
 *
 * reload:true — данные надо перечитать целиком (массовое изменение или переподключение после
 * обрыва: события за время обрыва потеряны). Вход отозван (код 4401) — без переподключения.
 */
(function (root) {
    'use strict';

    const RETRY_MIN_MS = 1000;
    const RETRY_MAX_MS = 30000;

    class WsClient {
        constructor(opts) {
            this.opts = opts || {};
            this.subs = new Map();          // typeId → Set<fn>
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
            if (!this.enabled() || !Number.isInteger(t) || t <= 0) return function () {};
            let set = this.subs.get(t);
            if (!set) {
                set = new Set();
                this.subs.set(t, set);
                this.sendIfOpen({ op: 'sub', t: t });
            }
            set.add(fn);
            this.connect();
            return () => {
                set.delete(fn);
                if (!set.size && this.subs.get(t) === set) {
                    this.subs.delete(t);
                    this.sendIfOpen({ op: 'unsub', t: t });
                }
            };
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
                this.subs.forEach((set, t) => ws.send(JSON.stringify({ op: 'sub', t: t })));
                if (this.opened) this.dispatchAll({ by: '', reload: true, events: [] });
                this.opened = true;
            };
            ws.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch (err) { return; }
                if (msg && msg.op === 'events') this.dispatch(msg);
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

        // Подписчику типа t — только события, в цепочке которых есть t (схема — сам тип t)
        dispatch(msg) {
            this.subs.forEach((set, t) => {
                const events = (msg.events || []).filter((e) => (e.k === 'schema' ? e.t === t : (e.types || []).indexOf(t) >= 0));
                if (!events.length && !msg.reload) return;
                const out = { by: msg.by || '', reload: !!msg.reload, events: events };
                set.forEach((fn) => this.safe(fn, out));
            });
        }

        dispatchAll(out) {
            this.subs.forEach((set) => set.forEach((fn) => this.safe(fn, out)));
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
