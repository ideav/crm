/* CPQ: воронка КП. Список КП со статусами, суммы по этапам, конверсия, КП ниже маржи. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    const st = { mgr: '', status: '', q: '' };
    let M = null, quotes = [], items = [];

    const FUNNEL = ['Черновик', 'На согласовании', 'Согласовано', 'Отправлено клиенту', 'Выиграно'];
    function stats(list) {
        const by = {}; M.statuses.forEach(s => { by[s['Статус КП']] = { n: 0, sum: 0 }; });
        list.forEach(q => { const b = by[q.status] || (by[q.status] = { n: 0, sum: 0 }); b.n++; b.sum += q.total; });
        return by;
    }
    function render() {
        const host = W.host; host.innerHTML = '';
        const minM = M.settings['Минимальная маржа, %'] || 0;
        const base = quotes.filter(q => (!st.mgr || q.mgr === st.mgr));
        const by = stats(base), list = base.filter(q => (!st.status || q.status === st.status) && (!st.q || (q.code + ' ' + q.client).toLowerCase().indexOf(st.q.toLowerCase()) >= 0));
        const won = by['Выиграно'] || { n: 0, sum: 0 }, lost = by['Проиграно'] || { n: 0, sum: 0 };
        const open = base.filter(q => !W.CLOSED[q.status]), openSum = open.reduce((s, q) => s + q.total, 0);
        const waiting = by['На согласовании'] ? by['На согласовании'].n : 0;
        const below = base.filter(q => q.margin < minM && !W.CLOSED[q.status]).length;
        host.appendChild(W.el('div', { 'class': 'cpq-head' }, [W.el('div', {}, [W.el('h1', { text: 'Воронка КП' }), W.el('p', { 'class': 'cpq-sub', text: 'Все коммерческие предложения: от черновика до договора. Скидки и маржа видны в момент КП, согласование не уходит в мессенджеры.' })]),
            W.el('a', { 'class': 'cpq-btn cpq-primary', href: W.url('wizard'), text: 'Новое КП' })]));
        const kpi = (k, v, sub, cls) => W.el('div', { 'class': 'cpq-kpi ' + (cls || '') }, [W.el('span', { 'class': 'cpq-muted', text: k }), W.el('strong', { text: v }), W.el('span', { 'class': 'cpq-muted cpq-small', text: sub || '' })]);
        const conv = won.n + lost.n ? Math.round(won.n / (won.n + lost.n) * 100) : 0;
        host.appendChild(W.el('div', { 'class': 'cpq-kpis' }, [kpi('В работе', C.money(openSum) + ' ₽', open.length + ' КП'), kpi('Выиграно', C.money(won.sum) + ' ₽', won.n + ' КП'), kpi('Конверсия в заказ', conv + '%', 'выиграно из закрытых'),
            kpi('Ждут согласования', String(waiting), 'скидка выше лимита', waiting ? 'cpq-kpi-warn' : ''), kpi('Ниже минимальной маржи', String(below), 'в открытых КП', below ? 'cpq-kpi-bad' : '')]));
        const mgrSel = W.select([['', 'Все менеджеры']].concat(M.managers.map(m => [m['Менеджер'], m['Менеджер']])), st.mgr); mgrSel.onchange = () => { st.mgr = mgrSel.value; render(); };
        const search = W.el('input', { type: 'search', placeholder: 'Номер или клиент', value: st.q, 'aria-label': 'Поиск', onchange: e => { st.q = e.target.value; render(); } });
        host.appendChild(W.el('div', { 'class': 'cpq-bar' }, [W.field('Менеджер', mgrSel), W.field('Поиск', search), st.status ? W.btn('Сбросить этап: ' + st.status, () => { st.status = ''; render(); }) : null]));
        const maxSum = Math.max.apply(null, FUNNEL.map(s => (by[s] || { sum: 0 }).sum).concat([1]));
        host.appendChild(W.el('div', { 'class': 'cpq-funnel', 'aria-label': 'Воронка' }, FUNNEL.concat(['Проиграно']).map(s => {
            const b = by[s] || { n: 0, sum: 0 };
            return W.el('button', { type: 'button', 'class': 'cpq-stage' + (st.status === s ? ' cpq-on' : ''), 'data-stage': s, onclick: () => { st.status = st.status === s ? '' : s; render(); } }, [
                W.el('span', { 'class': 'cpq-stage-n', text: String(b.n) }), W.el('span', { 'class': 'cpq-stage-t', text: s }), W.el('span', { 'class': 'cpq-stage-s', text: C.money(b.sum) + ' ₽' }),
                W.el('span', { 'class': 'cpq-stage-bar' }, [W.el('i', { 'class': 'cpq-bar-' + (W.STATUS_KIND[s] || 'info'), style: 'width:' + Math.max(4, Math.round(b.sum / maxSum * 100)) + '%' })])]);
        })));
        const o = by['Отклонено руководителем'];
        if (o && o.n) host.appendChild(W.el('p', { 'class': 'cpq-muted cpq-small', text: 'Отклонено руководителем и ждёт пересборки: ' + o.n + ' КП.' }));
        host.appendChild(W.table([
            { k: 'code', t: 'КП', html: r => '<strong>' + W.esc(r.code) + '</strong>' }, { k: 'client', t: 'Клиент' }, { k: 'mgr', t: 'Менеджер' },
            { k: 'status', t: 'Статус', html: r => W.badge(r.status, W.STATUS_KIND[r.status]) }, { k: 'date', t: 'Дата', html: r => W.esc(C.toDmy(r.date)) },
            { k: 'disc', t: 'Скидка', num: true, html: r => r.disc ? W.esc(C.round1(r.disc) + '%') : '-' }, { k: 'total', t: 'Итого, ₽', num: true },
            { k: 'margin', t: 'Маржа', num: true, cls: r => (r.margin < minM ? 'cpq-bad-text' : ''), html: r => W.esc(C.round1(r.margin) + '%') },
            { k: 'approver', t: 'Согласование', html: r => r.needs ? (r.status === 'На согласовании' ? W.badge('ждёт: ' + (r.approver || 'руководитель'), 'warn') : W.esc(r.approver || '')) : '<span class="cpq-muted">не нужно</span>' }
        ], list, { onrow: r => { location.href = W.url('quote') + '#id=' + r.id; }, empty: 'КП не найдено' }));
        const prod = {}; items.forEach(i => { prod[i['Изделие']] = (prod[i['Изделие']] || 0) + C.num(i['Сумма']); });
        const keys = Object.keys(prod).sort((a, b) => prod[b] - prod[a]), mx = prod[keys[0]] || 1;
        if (keys.length) {
            host.appendChild(W.el('h2', { text: 'Сумма КП по изделиям' }));
            host.appendChild(W.el('div', { 'class': 'cpq-card' }, keys.map(k => W.el('div', { 'class': 'cpq-lane' }, [W.el('span', { text: k }), W.el('span', { 'class': 'cpq-track' }, [W.el('i', { style: 'width:' + Math.round(prod[k] / mx * 100) + '%' })]), W.el('span', { 'class': 'cpq-num', text: C.money(prod[k]) + ' ₽' })]))));
        }
    }
    W.mount(() => Promise.all([W.loadModel(), W.loadQuotes(), W.report('Позиции КП').catch(() => [])]).then(r => { M = r[0]; quotes = r[1]; items = r[2]; render(); }));
})();
