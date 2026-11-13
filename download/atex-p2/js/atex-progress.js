// Окно прогресса длительных операций рабочих мест Фазы 2 atex (ideav/crm#5504).
//
// Модальный оверлей поверх страницы: заголовок этапа, полоса, счётчик «N из M», строка «что
// сейчас делается» и секундомер. Пока окно открыто, страница под ним не кликается — операцию
// не запустить второй раз и не переключить вкладку посреди записи. Кнопок нет: окно только
// показывает ход, закрывает его код операции (`close()` в finally-ветке).
//
//   var p = AtexProgress.open('Сверка с базой', { total: 10, detail: 'Справочники' });
//   p.step('Позиции заказов', 200);   // новый этап: заголовок и счётчик с нуля
//   p.tick();                         // +1 к счётчику
//   p.set(37, 'Заказ 12345');         // счётчик и строка под полосой
//   p.close();
//
// total ≤ 0 — этап без счётчика: полоса «бежит», виден только секундомер.
// Стили — css/atex-progress.css.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    function percent(done, total) {
        var t = Number(total) || 0, d = Number(done) || 0;
        if (t <= 0) return 0;
        return Math.max(0, Math.min(100, Math.round(d / t * 100)));
    }

    // Строка счётчика: «37 из 200 · 12 с»; без total — только секунды.
    function counterText(done, total, seconds) {
        var parts = [];
        if (Number(total) > 0) parts.push((Number(done) || 0) + ' из ' + total);
        if (seconds > 0) parts.push(seconds + ' с');
        return parts.join(' · ');
    }

    function node(doc, tag, cls, text) {
        var el = doc.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    function Progress(doc, title, opts) {
        var o = opts || {};
        var self = this;
        this.doc = doc;
        this.now = o.now || function() { return Date.now(); };
        this.since = this.now();
        this.overlay = node(doc, 'div', 'atex-progress');
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-modal', 'true');
        this.overlay.setAttribute('aria-live', 'polite');
        var box = node(doc, 'div', 'atex-progress-box');
        this.titleEl = node(doc, 'div', 'atex-progress-title');
        this.bar = node(doc, 'div', 'atex-progress-bar');
        this.fill = node(doc, 'div', 'atex-progress-fill');
        this.bar.appendChild(this.fill);
        this.countEl = node(doc, 'div', 'atex-progress-count');
        this.detailEl = node(doc, 'div', 'atex-progress-detail');
        box.appendChild(this.titleEl);
        box.appendChild(this.bar);
        box.appendChild(this.countEl);
        box.appendChild(this.detailEl);
        this.overlay.appendChild(box);
        (doc.body || doc.documentElement).appendChild(this.overlay);
        this.open = true;
        this.step(title, o.total, o.detail);
        // Секундомер идёт и тогда, когда счётчик стоит (долгий запрос) — видно, что страница жива.
        if (o.timer !== false && typeof setInterval === 'function') {
            this.timer = setInterval(function() { self.render(); }, 500);
        }
    }

    Progress.prototype.step = function(title, total, detail) {
        this.title = title || '';
        this.total = Number(total) || 0;
        this.done = 0;
        this.detail = detail || '';
        this.render();
        return this;
    };

    Progress.prototype.set = function(done, detail) {
        this.done = Number(done) || 0;
        if (detail != null) this.detail = detail;
        this.render();
        return this;
    };

    Progress.prototype.tick = function(detail) { return this.set(this.done + 1, detail); };

    // Обёртка промиса: +1 к счётчику, когда он завершится (успешно или нет).
    Progress.prototype.track = function(promise) {
        var self = this;
        return Promise.resolve(promise).then(function(v) { self.tick(); return v; }, function(e) { self.tick(); throw e; });
    };

    Progress.prototype.seconds = function() { return Math.floor((this.now() - this.since) / 1000); };

    Progress.prototype.render = function() {
        if (!this.open) return;
        this.titleEl.textContent = this.title;
        this.bar.className = 'atex-progress-bar' + (this.total > 0 ? '' : ' is-indeterminate');
        this.fill.style.width = (this.total > 0 ? percent(this.done, this.total) : 0) + '%';
        this.countEl.textContent = counterText(this.done, this.total, this.seconds());
        this.detailEl.textContent = this.detail;
    };

    Progress.prototype.close = function() {
        if (!this.open) return;
        this.open = false;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    };

    // Открыть окно. Без document (Node, тесты без DOM) — немое окно с тем же API.
    function open(title, opts) {
        var o = opts || {};
        var doc = o.document || root.document;
        if (!doc) return silent();
        return new Progress(doc, title, o);
    }

    function silent() {
        var p = { open: true, title: '', total: 0, done: 0, detail: '' };
        p.step = function(t, n, d) { p.title = t || ''; p.total = Number(n) || 0; p.done = 0; p.detail = d || ''; return p; };
        p.set = function(n, d) { p.done = Number(n) || 0; if (d != null) p.detail = d; return p; };
        p.tick = function(d) { return p.set(p.done + 1, d); };
        p.track = function(pr) { return Promise.resolve(pr).then(function(v) { p.tick(); return v; }, function(e) { p.tick(); throw e; }); };
        p.close = function() { p.open = false; };
        return p;
    }

    return { open: open, percent: percent, counterText: counterText, Progress: Progress };
});
