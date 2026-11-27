/* BI-сводка: каталог метрик. Одна «выручка» с формулой, владельцем и датой утверждения; подписки на сводку и сигналы. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;

    function edit(M, m) {
        var def = B.el('textarea', { rows: 3 }), fm = B.el('textarea', { rows: 2 }), th = B.el('input', { type: 'number', min: 1, max: 50, step: 1 });
        def.value = m.def; fm.value = m.formula; th.value = m.thr;
        var body = B.el('div', {}, [B.field('Определение', def), B.field('Формула', fm), B.field('Порог отклонения, %', th, 'Отклонение больше порога требует комментария и попадает в сигналы')]);
        B.modal('Метрика «' + m.name + '»', body, [{ text: 'Сохранить', cls: 'bi-primary', fn: function (close) {
            if (!def.value.trim() || !fm.value.trim()) { B.toast('Определение и формула обязательны', true); return false; }
            B.update(m.rid, { 'Определение метрики': def.value.trim(), 'Формула метрики': fm.value.trim(), 'Порог отклонения, %': C.num(th.value) || m.thr, 'Владелец метрики': B.ctx.user, 'Определение утверждено': B.TODAY })
                .then(function () { B.toast('Определение обновлено, дата утверждения — сегодня'); close(); B.reload(); }).catch(function (e) { B.toast(e.message, true); });
            return false;
        } }, { text: 'Отмена' }], true);
    }
    function render(host, M) {
        host.appendChild(B.el('h1', { text: 'Каталог метрик' }));
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: 'У каждой цифры сводки одно определение: формула, владелец и дата утверждения. Сводка, план-факт и сверка считают по этим правилам, поэтому у маркетинга, продаж и финансов одна и та же «выручка» и одни и те же «лиды».' }));
        var canW = B.canWrite('Метрика');
        host.appendChild(B.el('div', { 'class': 'bi-cards' }, M.metrics.map(function (m) {
            return B.el('div', { 'class': 'bi-card' }, [B.el('h3', { html: B.esc(m.name) + ' <span class="bi-muted">' + B.esc(m.unit) + '</span>' }), B.el('p', { text: m.def }),
                B.el('div', { 'class': 'bi-formula', text: m.formula }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Владелец</span><b>' + B.esc(m.owner) + '</b>' }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Утверждено</span><b>' + C.toDmy(m.approved) + '</b>' }),
                B.el('div', { 'class': 'bi-kv', html: '<span>Порог отклонения</span><b>' + m.thr + '%</b>' }),
                canW ? B.btn('Изменить определение', function () { edit(M, m); }, 'bi-small') : null]);
        })));
        host.appendChild(B.el('h2', { text: 'Подписки на сводку и сигналы' }));
        host.appendChild(B.table([{ t: 'Подписка', html: function (s) { return '<b>' + B.esc(s.name) + '</b><div class="bi-muted">' + B.esc(s.what) + '</div>'; } }, { t: 'Кому', k: 'who' }, { t: 'Канал', k: 'ch' }, { t: 'Время', k: 'at' }, { t: 'Порог', num: true, html: function (s) { return s.thr + '%'; } }], M.subscr, { empty: 'Подписок нет' }));
    }
    B.mount(render);
})();
