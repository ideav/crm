/* BI-сводка: расхождения источников. «У маркетинга 124 лида, у продаж 117» — разбор по причинам с лидами поимённо. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;
    var st = { open: {} };

    function mask(p) { return String(p || '').replace(/(\d{3})-(\d{2})-(\d{2})$/, '***-**-$3'); }
    function render(host, M) {
        host.appendChild(B.el('h1', { text: 'Расхождения источников: лиды' }));
        if (!M.leads) { host.appendChild(B.el('p', { 'class': 'bi-error', text: 'Роли не выдан доступ к лидам источников.' })); return; }
        var per = C.period('month', B.TODAY);
        var mkSrc = 'Excel', saSrc = 'Битрикс24';
        var mk = M.leads.filter(function (l) { return l.source === mkSrc; }), sa = M.leads.filter(function (l) { return l.source === saSrc; });
        var r = C.reconcileLeads(mk, sa, per.from, per.to);
        var def = M.metrics.filter(function (m) { return m.name === 'Лиды'; })[0];
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: 'Отчёт маркетинга (выгрузка Метрики в Excel) и лиды Битрикс24 за ' + per.label + ' сверены по номеру телефона. Каждая разница названа причиной и раскрывается до конкретных лидов — спорить о цифре на планёрке больше не нужно.' }));
        host.appendChild(B.freshBar(M));
        host.appendChild(B.el('div', { 'class': 'bi-vs' }, [
            B.el('div', { 'class': 'bi-vs-side' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'Маркетинг (Excel, по дате клика)' }), B.el('div', { 'class': 'bi-vs-n', text: String(r.mkCount) })]),
            B.el('div', { 'class': 'bi-vs-mid' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'совпали по телефону' }), B.el('div', { 'class': 'bi-vs-m', text: String(r.matched) })]),
            B.el('div', { 'class': 'bi-vs-side' }, [B.el('div', { 'class': 'bi-kpi-l', text: 'Продажи (Битрикс24, по дате создания)' }), B.el('div', { 'class': 'bi-vs-n', text: String(r.salesCount) })])
        ]));
        /* цепочка: 124 → … → 117 */
        var run = r.mkCount, steps = [B.el('div', { 'class': 'bi-step bi-step-total' }, [B.el('b', { text: String(r.mkCount) }), ' у маркетинга'])];
        r.list.forEach(function (g) {
            var n = g.items.length, sign = g.side === 'mk' ? -1 : 1; run += sign * n;
            var open = !!st.open[g.key];
            var head = B.el('button', { type: 'button', 'class': 'bi-step', 'aria-expanded': open ? 'true' : 'false', onclick: function () { st.open[g.key] = !open; B.render(); } }, [
                B.el('span', { 'class': 'bi-step-n ' + (sign < 0 ? 'bi-minus' : 'bi-plus'), text: (sign < 0 ? '−' : '+') + n }),
                B.el('span', {}, [B.el('b', { text: g.label }), B.el('div', { 'class': 'bi-muted', text: g.why })]),
                B.el('span', { 'class': 'bi-step-run', text: '= ' + run })
            ]);
            steps.push(head);
            if (open) steps.push(B.table([
                { t: 'Лид', html: function (x) { return '<b>' + B.esc(x.lead.id) + '</b><div class="bi-muted">' + B.esc(x.lead.source) + '</div>'; } },
                { t: 'Дата', html: function (x) { return C.toDmy(x.lead.date); } },
                { t: 'Телефон', html: function (x) { return B.esc(mask(x.lead.phone)); } },
                { t: 'Канал', html: function (x) { return B.esc(x.lead.channel) + (x.lead.comment ? '<div class="bi-muted">' + B.esc(x.lead.comment) + '</div>' : ''); } },
                { t: 'Пара в другом источнике', html: function (x) { return x.pair ? B.esc(x.pair.id) + ' от ' + C.toDmy(x.pair.date) : (x.note ? B.esc(x.note) : '<span class="bi-muted">нет</span>'); } }
            ], g.items));
        });
        steps.push(B.el('div', { 'class': 'bi-step bi-step-total' }, [B.el('b', { text: String(run) }), ' у продаж' + (run === r.salesCount ? ' — разница объяснена полностью' : ' — остаток ' + (r.salesCount - run) + ' без причины')]));
        host.appendChild(B.el('div', { 'class': 'bi-steps' }, steps));
        if (def) host.appendChild(B.el('div', { 'class': 'bi-card' }, [B.el('h3', { text: 'Единое определение: ' + def.name }), B.el('p', { text: def.def }), B.el('div', { 'class': 'bi-muted', text: 'Формула: ' + def.formula + ' · владелец ' + def.owner + ' · утверждено ' + C.toDmy(def.approved) }), B.el('p', { html: 'Все определения — в <a href="' + B.esc(B.nav('metrics')) + '">каталоге метрик</a>.' })]));
    }
    B.mount(render);
})();
