/* Взыскание: стоп-лист для склада и менеджеров; запросы разблокировки и решения по ним. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;

    function decide(host, q, ok) {
        var why = W.el('input', { type: 'text', value: ok ? 'Отгрузка под предоплату' : '' });
        W.modal((ok ? 'Одобрить: ' : 'Отклонить: ') + q.client, W.el('div', {}, [W.el('p', { 'class': 'dbt-mini', text: q.comment }), W.field('Решение', why)]), [{ text: ok ? 'Одобрить' : 'Отклонить', cls: ok ? 'dbt-primary' : 'dbt-danger', fn: function () {
            M.set(q.id, { 'Решение': why.value, 'Статус запроса': ok ? 'Запрос: одобрен' : 'Запрос: отклонён' }).then(function () { W.toast('Решение записано'); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function render(host) {
        host.innerHTML = '';
        var stopped = Object.keys(M.clients).map(function (k) { return M.clients[k]; }).filter(function (c) { return c.stop; }).sort(function (a, b) { return a.stopDate < b.stopDate ? 1 : -1; });
        var warehouse = W.ctx.role === 'Склад';
        host.appendChild(W.el('h1', { text: 'Стоп-лист' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: warehouse ? 'Клиенты, которым отгрузка остановлена. Отгружать только по письменному решению финансового директора.' : 'Флаг стоп-отгрузки виден менеджерам и складу; в учётную систему он уходит отдельным обменом.' }));
        host.appendChild(W.el('div', { 'class': 'dbt-kpis' }, [W.el('div', { 'class': 'dbt-kpi dbt-kpi-warn' }, [W.el('div', { 'class': 'dbt-kpi-v', text: String(stopped.length) }), W.el('div', { 'class': 'dbt-kpi-l', text: 'клиентов на стоп-отгрузке' })])]));
        host.appendChild(W.table([
            { t: 'Клиент', html: function (c) { return '<b>' + W.esc(c.name) + '</b>'; } }, { t: 'Причина', k: 'stopReason' }, { t: 'С даты', html: function (c) { return c.stopDate ? C.toDmy(c.stopDate) : ''; } },
            { t: 'Кто поставил', k: 'stopBy' }, { t: 'Менеджер', html: function (c) { return W.esc(W.shortFio(c.mgr)); } },
            { t: 'Долг, ₽', num: true, html: function (c) { var r = M.byName[c.name]; return r ? W.money(r.debt) : ''; } }], stopped, { empty: 'Стоп-отгрузок нет' }));
        if (warehouse || !M.requests.length) return;
        host.appendChild(W.el('h2', { text: 'Запросы разблокировки' }));
        var canDecide = W.ctx.role.indexOf('Менеджер') !== 0 && W.canWrite('Запрос разблокировки');
        var tbl = W.table([
            { t: 'Дата', html: function (q) { return C.toDmy(q.date); } }, { t: 'Клиент', html: function (q) { return '<b>' + W.esc(q.client) + '</b>'; } }, { t: 'Менеджер', html: function (q) { return W.esc(W.shortFio(q.mgr)); } },
            { t: 'Комментарий', k: 'comment' }, { t: 'Статус', html: function (q) { return W.badge(W.short(q.status), q.status === 'Запрос: одобрен' ? 'ok' : q.status === 'Запрос: отклонён' ? 'crit' : 'warn'); } }, { t: 'Решение', k: 'decision' }, { t: '', html: function () { return ''; } }], M.requests);
        [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) {
            var q = M.requests[i]; if (!canDecide || q.status !== 'Запрос: на рассмотрении') return;
            var td = tr.children[6]; td.appendChild(W.btn('Одобрить', function () { decide(host, q, true); }, 'dbt-primary')); td.appendChild(W.btn('Отклонить', function () { decide(host, q, false); }));
        });
        host.appendChild(tbl);
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
