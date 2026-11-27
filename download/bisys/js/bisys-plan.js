/* BI-сводка: план-факт и отклонения. Карточка отклонения с обязательным комментарием, сигнал в мессенджер, журнал сигналов. */
(function () {
    'use strict';
    var B = window.Bisys, C = B.core;
    var st = { p: 'month', opened: false };

    function card(M, d) {
        var c = d.card, ta = B.el('textarea', { rows: 4, placeholder: 'Причина отклонения и что делаем. Например: ремонт эскалатора в ТЦ с 10.11, вход с парковки закрыт; договорились с ТЦ о навигации до 30.11' });
        ta.value = c ? c.comment : '';
        var err = B.el('div', {});
        var body = B.el('div', {}, [
            B.el('div', { 'class': 'bi-kv', html: '<span>Метрика</span><b>' + B.esc(d.metric) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Факт / план за ' + B.esc(C.period(st.p, B.TODAY).label) + '</span><b>' + B.money(d.fact) + ' / ' + B.money(d.plan) + '</b>' }),
            B.el('div', { 'class': 'bi-kv', html: '<span>Отклонение</span><b class="bi-red">' + B.pct(d.dev, true) + '</b>' }),
            d.missingFrom ? B.el('div', { 'class': 'bi-warnbox bi-w', text: 'Нет данных с ' + C.toDmy(d.missingFrom) + ': часть отклонения — незагруженный источник, а не продажи.' }) : null,
            B.el('div', { 'class': 'bi-kv', html: '<span>Статус</span><b>' + B.esc(c ? c.status : 'Новое (карточки ещё нет)') + '</b>' }),
            c && c.author ? B.el('div', { 'class': 'bi-kv', html: '<span>Комментарий оставил</span><b>' + B.esc(c.author) + '</b>' }) : null,
            B.field('Комментарий к отклонению (обязателен)', ta, 'Не меньше ' + C.COMMENT_MIN + ' знаков: причина и действие. Без комментария карточку не закрыть.'),
            err,
            B.el('p', { html: '<a href="' + B.esc(B.nav('drill', { p: st.p, sub: d.sub })) + '">Документы подразделения за период →</a>' })
        ]);
        var canW = B.canWrite('Отклонение');
        var btns = [{ text: 'Закрыть' }];
        if (B.canWrite('Сигнал')) btns.unshift({ text: 'Отправить сигнал', fn: function (close) { signal(M, d).then(close); return false; } });
        if (canW) btns.unshift({ text: c && c.status === 'Прокомментировано' ? 'Сохранить и закрыть отклонение' : 'Сохранить комментарий', cls: 'bi-primary', fn: function (close) {
            var ns = C.nextStatus(c ? c.status : 'Новое', ta.value);
            err.innerHTML = '';
            if (!ns.ok) { err.appendChild(B.el('div', { 'class': 'bi-warnbox bi-e', text: ns.error })); return false; }
            var f = { 'Статус отклонения': ns.status, 'Комментарий отклонения': ta.value.trim(), 'Автор комментария': B.ctx.user };
            var pr = c ? B.update(c.rid, f) : B.create('Отклонение', Object.assign({ 'Отклонение': C.nextCode(M.cards.map(function (x) { return x.code; }), 'ОТК-'), 'Подразделение': d.sub, 'Метрика': d.metric, 'Дата отклонения': C.addDays(B.TODAY, -1), 'Факт отклонения': Math.round(d.fact), 'План отклонения': Math.round(d.plan), 'Отклонение, %': d.dev, 'Срок решения': C.addDays(B.TODAY, 2) }, f));
            pr.then(function () { B.toast('Отклонение: ' + ns.status.toLowerCase()); close(); B.reload(); }).catch(function (e) { err.appendChild(B.el('div', { 'class': 'bi-warnbox bi-e', text: e.message })); });
            return false;
        } });
        B.modal(d.sub + ': ' + d.metric.toLowerCase(), body, btns, true);
    }
    function signal(M, d) {
        var text = C.signalText(d, B.money);
        var sub = M.subscr.filter(function (s) { return M.subs.some(function (x) { return x.name === d.sub && x.manager === s.who; }); })[0] || M.subscr[0];
        var f = { 'Сигнал': C.nextCode(M.signals.map(function (s) { return s.code; }), 'СГ-'), 'Подписка': sub ? sub.name : '', 'Дата сигнала': B.TODAY, 'Время сигнала': String(new Date().getHours()).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0'), 'Текст сигнала': text, 'Статус сигнала': 'В очереди' };
        if (d.card) f['Отклонение'] = d.card.rid;
        return B.create('Сигнал', f).then(function () { B.toast('Сигнал поставлен в очередь: ' + (sub ? sub.who + ', ' + sub.ch : '')); B.reload(); }).catch(function (e) { B.toast(e.message, true); });
    }

    function render(host, M) {
        var per = C.period(st.p, B.TODAY);
        var pf = C.planFact(M.mySubs, M.docs, M.plans, per.from, per.to, M.thr), devs = C.topDeviations(pf, M.cards);
        host.appendChild(B.el('h1', { text: 'План-факт и отклонения' }));
        host.appendChild(B.el('p', { 'class': 'bi-sub', text: 'План — из Excel финансиста (месяц делится по дням), факт — из всех источников. Отклонение больше порога из каталога метрик требует комментария ответственного; причина остаётся в карточке, а не в мессенджере.' }));
        host.appendChild(B.freshBar(M));
        host.appendChild(B.tabs([['yesterday', 'Вчера'], ['week', '7 дней'], ['month', 'Месяц']], st.p, function (k) { st.p = k; B.render(); }));
        host.appendChild(B.table([
            { t: 'Подразделение', html: function (r) { return '<b>' + B.esc(r.sub) + '</b>' + (r.missingFrom ? '<div class="bi-muted">нет данных с ' + C.toDmy(r.missingFrom) + '</div>' : ''); } },
            { t: 'Выручка факт', num: true, html: function (r) { return B.money(r.fact); } }, { t: 'План', num: true, html: function (r) { return B.money(r.plan); } },
            { t: 'К плану', num: true, html: function (r) { return B.badge(B.pct(r.dev, true), r.flags.indexOf('Выручка') >= 0 ? 'crit' : r.dev < 0 ? 'warn' : 'ok'); } },
            { t: 'Валовая прибыль', num: true, html: function (r) { return B.money(r.gp); } },
            { t: 'К плану', num: true, html: function (r) { return B.badge(B.pct(r.gpDev, true), r.flags.indexOf('Валовая прибыль') >= 0 ? 'crit' : r.gpDev < 0 ? 'warn' : 'ok'); } },
            { t: 'Маржа', num: true, html: function (r) { return B.pct(r.margin); } }
        ], pf, { rowCls: function (r) { return r.flags.length ? 'bi-row-bad' : ''; } }));
        host.appendChild(B.el('h2', { text: 'Отклонения больше порога: ' + devs.length + ', без комментария: ' + devs.filter(function (d) { return !d.commented; }).length }));
        host.appendChild(B.table([
            { t: 'Подразделение', html: function (d) { return '<b>' + B.esc(d.sub) + '</b><div class="bi-muted">' + B.esc(d.metric) + '</div>'; } },
            { t: 'Отклонение', num: true, html: function (d) { return '<b class="bi-red">' + B.pct(d.dev, true) + '</b>'; } },
            { t: 'Комментарий', html: function (d) { return d.commented ? B.esc(d.card.comment) : B.badge('нет комментария', 'crit'); } },
            { t: 'Статус', html: function (d) { return d.card ? B.badge(d.card.status, d.card.status === 'Новое' ? 'crit' : d.card.status === 'Закрыто' ? 'mute' : 'ok') + (d.card.due ? '<div class="bi-muted">срок ' + C.toDmy(d.card.due) + '</div>' : '') : B.badge('новое', 'crit'); } }
        ], devs, { onrow: function (d) { card(M, d); }, empty: 'Отклонений больше порога нет' }));
        host.appendChild(B.el('h2', { text: 'Сигналы' }));
        host.appendChild(B.table([{ t: 'Сигнал', html: function (s) { return '<b>' + B.esc(s.code) + '</b><div class="bi-muted">' + B.esc(s.sub) + '</div>'; } }, { t: 'Когда', html: function (s) { return C.toDmy(s.date) + ' ' + B.esc(s.time); } }, { t: 'Текст', k: 'text' }, { t: 'Статус', html: function (s) { return B.badge(s.status, s.status === 'Отправлен' ? 'ok' : 'info'); } }],
            M.signals.slice().sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; }), { empty: 'Сигналов нет' }));
        host.appendChild(B.el('p', { 'class': 'bi-muted', text: 'В демо сигнал встаёт в очередь журнала; отправку в Telegram подключаем ботом базы.' }));
        var h = B.hash();
        if (!st.opened && h.sub) { st.opened = true; var d = devs.filter(function (x) { return x.sub === h.sub && (!h.m || x.metric === h.m); })[0]; if (d) card(M, d); }
    }
    B.mount(render);
})();
