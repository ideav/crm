/* CPQ: карточка КП. Печатная форма (PDF через печать браузера), статусы, согласование скидки, журнал. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    const COMPANY = { name: 'ООО «Гидромаш-Урал»', addr: 'г. Екатеринбург, ул. Заводская, 14', contacts: 'sales@gidromash-ural.example · +7 (343) 000-00-00' };
    let M = null, Q = null, clients = [];
    const idFromHash = () => { const m = /[#&]id=(\d+)/.exec(location.hash); return m ? m[1] : ''; };
    const grp = () => W.clientGroup(clients, Q.client);

    function canApprove(approval) {
        const r = M.myRole;
        return r.approves && Q.mgr !== M.me.name && r.limit >= Q.disc - 1e-9 && (approval.lowMargin ? r.level >= M.roles[M.roles.length - 1].level : true);
    }
    function ask(title, label, required, okText, withReason, fn) {
        const t = W.el('textarea', { rows: '3', 'aria-label': label, placeholder: label });
        const reason = withReason ? W.select(M.lostReasons.map(x => [x, x]), M.lostReasons[0]) : null;
        const body = W.el('div', {}, [reason ? W.field('Причина', reason) : null, W.field(label, t)]);
        W.modal(title, body, [{ text: 'Отмена' }, { text: okText, cls: 'cpq-primary', keep: true, fn: close => {
            if (required && !t.value.trim()) { W.toast('Нужен комментарий', true); return false; }
            fn(t.value.trim(), reason ? reason.value : '').then(() => { close(); load(); }).catch(e => W.toast(e.message, true));
            return false;
        } }]);
    }
    function actions(q) {
        const a = q.q.approval, bar = [];
        const go = (status, f, name, text) => () => W.setStatus(Q.id, status, f, name, text).then(() => { W.toast('Статус: ' + status); load(); }).catch(e => W.toast(e.message, true));
        if (Q.status === 'Черновик' || Q.status === 'Отклонено руководителем') {
            bar.push(W.el('a', { 'class': 'cpq-btn', href: W.url('wizard') + '#q=' + Q.id, text: 'Изменить в конфигураторе' }));
            if (a.blocked) bar.push(W.el('span', { 'class': 'cpq-badge cpq-crit', text: 'Скидка выше предела компании' }));
            else if (a.needs) bar.push(W.btn('Отправить на согласование: ' + a.approver, go('На согласовании', {}, 'Отправлено на согласование', a.reasons.join('; ')), 'cpq-primary'));
            else bar.push(W.btn('Отправить клиенту', go('Отправлено клиенту', {}, 'Отправлено клиенту', 'PDF и ссылка'), 'cpq-primary'));
        } else if (Q.status === 'На согласовании') {
            if (canApprove(a)) {
                bar.push(W.btn('Согласовать', () => ask('Согласовать скидку ' + C.round1(Q.disc) + '%', 'Комментарий (необязательно)', false, 'Согласовать', false, c => W.setStatus(Q.id, 'Согласовано', {}, 'Согласовано', c || ('Скидка ' + C.round1(Q.disc) + '% согласована'))), 'cpq-primary'));
                bar.push(W.btn('Отклонить', () => ask('Отклонить скидку', 'Что исправить менеджеру', true, 'Отклонить', false, c => W.setStatus(Q.id, 'Отклонено руководителем', {}, 'Отклонено', c)), 'cpq-danger'));
            } else bar.push(W.el('span', { 'class': 'cpq-badge cpq-warn', text: 'Ждёт: ' + (Q.approver || a.approver || 'руководитель') + (M.myRole.approves && M.myRole.limit < Q.disc ? ' (скидка выше вашего лимита ' + C.round1(M.myRole.limit) + '%)' : '') }));
        } else if (Q.status === 'Согласовано') bar.push(W.btn('Отправить клиенту', go('Отправлено клиенту', {}, 'Отправлено клиенту', 'PDF и ссылка'), 'cpq-primary'));
        else if (Q.status === 'Отправлено клиенту') {
            bar.push(W.btn('Выиграно', go('Выиграно', {}, 'Выиграно', 'Клиент подтвердил'), 'cpq-primary'));
            bar.push(W.btn('Проиграно', () => ask('КП проиграно', 'Комментарий', false, 'Сохранить', true, (c, r) => W.setStatus(Q.id, 'Проиграно', { 'Причина отказа': r }, 'Проиграно', r + (c ? ': ' + c : ''))), 'cpq-danger'));
        }
        bar.push(W.btn('Печать / PDF', () => window.print()));
        return bar;
    }
    function doc(q) {
        const till = Q.until ? C.toDmy(Q.until) : '', lines = Q.items;
        const lead = Math.max.apply(null, lines.map(i => (M.prodBy[i.product] || { leadDays: 0 }).leadDays).concat([0]));
        const warr = lines.some(i => i.sel.indexOf('SRV-WAR') >= 0) ? 36 : 24;
        const rows = lines.map((it, i) => {
            const pr = M.prodBy[it.product];
            return '<tr><td>' + (i + 1) + '</td><td><strong>' + W.esc(pr.name) + '</strong><ul>' + C.describe(M, it.sel).map(n => '<li>' + W.esc(n) + '</li>').join('') + '</ul></td><td class="cpq-num">' + it.qty + '</td><td class="cpq-num">' + C.money(it.unit) + '</td><td class="cpq-num">' + C.money(it.lineTotal) + '</td></tr>';
        }).join('');
        const disc = Q.subtotal - Q.total, vat = C.round(Q.total * q.q.vatPct / 100);
        const d = W.el('div', { 'class': 'cpq-doc', id: 'cpq-doc' });
        d.innerHTML = '<div class="cpq-doc-head"><div class="cpq-logo">ГМ</div><div><strong>' + W.esc(COMPANY.name) + '</strong><br>' + W.esc(COMPANY.addr) + '<br>' + W.esc(COMPANY.contacts) + '</div></div>' +
            '<h2>Коммерческое предложение № ' + W.esc(Q.code) + ' от ' + C.toDmy(Q.date) + '</h2>' +
            '<p>Заказчик: <strong>' + W.esc(Q.client) + '</strong><br>Предложение действительно до ' + till + '. Менеджер: ' + W.esc(Q.mgr) + '.</p>' +
            '<table class="cpq-spec"><thead><tr><th>№</th><th>Наименование и комплектация</th><th class="cpq-num">Кол-во</th><th class="cpq-num">Цена, ₽</th><th class="cpq-num">Сумма, ₽</th></tr></thead><tbody>' + rows + '</tbody></table>' +
            '<table class="cpq-totals"><tr><td>Сумма по позициям</td><td class="cpq-num">' + C.money(Q.subtotal) + ' ₽</td></tr>' + (disc > 0 ? '<tr><td>Скидка ' + C.round1(Q.disc) + '%</td><td class="cpq-num">−' + C.money(disc) + ' ₽</td></tr>' : '') +
            '<tr><td>Итого без НДС</td><td class="cpq-num">' + C.money(Q.total) + ' ₽</td></tr><tr><td>НДС ' + q.q.vatPct + '%</td><td class="cpq-num">' + C.money(vat) + ' ₽</td></tr><tr class="cpq-grand"><td>Итого с НДС</td><td class="cpq-num">' + C.money(Q.total + vat) + ' ₽</td></tr></table>' +
            '<h3>Условия</h3><ul><li>Срок изготовления: до ' + lead + ' календарных дней с даты предоплаты.</li><li>Оплата: 50% предоплата, 50% перед отгрузкой.</li><li>Гарантия: ' + warr + ' месяца с даты ввода в эксплуатацию.</li><li>Комплектация проверена правилами совместимости производителя.</li></ul>' +
            '<div class="cpq-sign"><span>' + W.esc(Q.mgr) + '</span><span>Подпись, печать</span></div>';
        return d;
    }
    function render() {
        const host = W.host; host.innerHTML = '';
        const q = { q: C.priceQuote(M, Q.items, grp(), Q.disc, (M.managers.filter(x => x['Менеджер'] === Q.mgr)[0] || {})['Роль продаж'] || 'Менеджер') };
        host.appendChild(W.el('div', { 'class': 'cpq-noprint' }, [
            W.el('p', {}, [W.el('a', { href: W.url('funnel'), text: '← Воронка КП' })]),
            W.el('div', { 'class': 'cpq-head' }, [W.el('div', {}, [W.el('h1', { text: Q.code }), W.el('p', { 'class': 'cpq-sub' }, [W.el('span', { html: W.badge(Q.status, W.STATUS_KIND[Q.status]) }), ' ' + Q.client + ' · версия ' + Q.version])])]),
            W.el('div', { 'class': 'cpq-row cpq-actions' }, actions(q))]));
        if ((Q.status === 'Черновик' || Q.status === 'Отклонено руководителем') && Math.abs(q.q.total - Q.total) > 1)
            host.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-warn cpq-noprint' }, 'Цены каталога изменились после сохранения: по текущему прайсу итог ' + C.money(q.q.total) + ' ₽. Откройте КП в конфигураторе и сохраните, чтобы пересчитать.'));
        const a = q.q.approval;
        const side = W.el('div', { 'class': 'cpq-card cpq-noprint' }, [W.el('h3', { text: 'Скидка и маржа (внутренняя информация)' }),
            W.el('div', { 'class': 'cpq-kv' }, [W.el('span', { text: 'Скидка менеджера' }), W.el('span', { 'class': 'cpq-num', text: C.round1(Q.disc) + '%' })]),
            W.el('div', { 'class': 'cpq-kv' }, [W.el('span', { text: 'Маржа' }), W.el('span', { 'class': 'cpq-num' + (a.lowMargin ? ' cpq-bad-text' : ''), text: C.round1(Q.margin) + '% (минимум ' + C.round1(a.minMargin) + '%)' })]),
            W.el('div', { 'class': 'cpq-kv' }, [W.el('span', { text: 'Согласование' }), W.el('span', { text: Q.needs ? 'нужно: ' + (Q.approver || a.approver) : 'не требуется' })]),
            a.reasons.length ? W.el('p', { 'class': 'cpq-muted cpq-small', text: a.reasons.join('. ') }) : null]);
        const jr = W.table([{ k: 'date', t: 'Дата', html: r => W.esc(C.toDmy(r.date)) }, { k: 'name', t: 'Событие' }, { k: 'who', t: 'Автор' }, { k: 'text', t: 'Комментарий' }], Q.events, { empty: 'Событий нет' });
        host.appendChild(W.el('div', { 'class': 'cpq-quote-grid' }, [doc(q), W.el('div', {}, [side, W.el('h3', { 'class': 'cpq-noprint', text: 'Журнал' }), W.el('div', { 'class': 'cpq-noprint' }, [jr])])]));
    }
    function load() {
        const id = idFromHash(); if (!id) { W.host.textContent = 'Откройте КП из воронки.'; return Promise.resolve(); }
        return W.loadQuote(id, M).then(d => { Q = d; render(); });
    }
    W.mount(() => Promise.all([W.loadModel(), W.rows('Клиент')]).then(r => { M = r[0]; clients = r[1]; return load(); }));
    window.addEventListener('hashchange', () => { if (M) load(); });
})();
