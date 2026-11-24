/* CPQ: согласование скидок. Очередь КП, где скидка выше лимита менеджера или маржа ниже минимума. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    let M = null, quotes = [];

    function decide(q, ok) {
        const t = W.el('textarea', { rows: '3', 'aria-label': 'Комментарий', placeholder: ok ? 'Комментарий (необязательно)' : 'Что исправить менеджеру' });
        W.modal((ok ? 'Согласовать ' : 'Отклонить ') + q.code + ', скидка ' + C.round1(q.disc) + '%', W.el('div', {}, [W.el('p', { 'class': 'cpq-muted', text: q.client + ' · ' + C.money(q.total) + ' ₽ · маржа ' + C.round1(q.margin) + '%' }), W.field('Комментарий', t)]), [
            { text: 'Отмена' }, { text: ok ? 'Согласовать' : 'Отклонить', cls: ok ? 'cpq-primary' : 'cpq-danger', keep: true, fn: close => {
                if (!ok && !t.value.trim()) { W.toast('Нужен комментарий', true); return false; }
                W.setStatus(q.id, ok ? 'Согласовано' : 'Отклонено руководителем', {}, ok ? 'Согласовано' : 'Отклонено', t.value.trim() || ('Скидка ' + C.round1(q.disc) + '% согласована'))
                    .then(() => { close(); W.toast(ok ? 'Согласовано' : 'Отклонено'); load(); }).catch(e => W.toast(e.message, true)); return false; } }]);
    }
    function render() {
        const host = W.host; host.innerHTML = '';
        const me = M.myRole, minM = M.settings['Минимальная маржа, %'] || 0;
        const roleOf = n => { const m = M.managers.filter(x => x['Менеджер'] === n)[0]; return m ? m['Роль продаж'] : 'Менеджер'; };
        const waiting = quotes.filter(q => q.status === 'На согласовании').sort((a, b) => b.disc - a.disc);
        const done = quotes.filter(q => (q.status === 'Согласовано' || q.status === 'Отклонено руководителем')).slice(0, 12);
        host.appendChild(W.el('h1', { text: 'Согласование скидок' }));
        host.appendChild(W.el('p', { 'class': 'cpq-sub', text: 'Ваша роль: ' + M.me.role + (me.approves ? ', согласуете скидки до ' + C.round1(me.limit) + '%' : ', согласовать нельзя') + '. Лимиты задаёт коммерческий директор в таблице «Роль продаж».' }));
        host.appendChild(W.el('h2', { text: 'Ждут решения: ' + waiting.length }));
        host.appendChild(W.table([
            { k: 'code', t: 'КП', html: r => '<a href="' + W.url('quote') + '#id=' + r.id + '"><strong>' + W.esc(r.code) + '</strong></a>' }, { k: 'client', t: 'Клиент' },
            { k: 'mgr', t: 'Менеджер', html: r => W.esc(r.mgr) + '<br><span class="cpq-muted cpq-small">' + W.esc(roleOf(r.mgr)) + '</span>' },
            { k: 'total', t: 'Итого, ₽', num: true }, { k: 'disc', t: 'Скидка', num: true, html: r => W.esc(C.round1(r.disc) + '%') },
            { k: 'margin', t: 'Маржа', num: true, cls: r => r.margin < minM ? 'cpq-bad-text' : '', html: r => W.esc(C.round1(r.margin) + '%') },
            { k: 'approver', t: 'Согласующий', html: r => W.esc(r.approver || '') },
            { k: 'x', t: '', html: r => '<span data-q="' + r.id + '"></span>' }], waiting, { empty: 'Очередь пуста' }));
        waiting.forEach(q => {
            const cell = host.querySelector('span[data-q="' + q.id + '"]'); if (!cell) return;
            const lowM = q.margin < minM, top = M.roles[M.roles.length - 1];
            const can = me.approves && q.mgr !== M.me.name && me.limit >= q.disc - 1e-9 && (!lowM || me.level >= top.level);
            if (can) cell.parentNode.appendChild(W.el('div', { 'class': 'cpq-row' }, [W.btn('Согласовать', () => decide(q, true), 'cpq-primary'), W.btn('Отклонить', () => decide(q, false), 'cpq-danger')]));
            else cell.parentNode.appendChild(W.el('span', { 'class': 'cpq-muted cpq-small', text: me.approves ? (q.mgr === M.me.name ? 'Свою скидку согласовать нельзя' : 'Выше вашего лимита или нужна маржа ниже минимума: ' + (q.approver || 'руководитель')) : 'Только для руководителей' }));
        });
        host.appendChild(W.el('h2', { text: 'Недавние решения' }));
        host.appendChild(W.table([{ k: 'code', t: 'КП' }, { k: 'client', t: 'Клиент' }, { k: 'mgr', t: 'Менеджер' }, { k: 'status', t: 'Решение', html: r => W.badge(r.status === 'Согласовано' ? 'Согласовано' : 'Отклонено', r.status === 'Согласовано' ? 'ok' : 'crit') },
            { k: 'disc', t: 'Скидка', num: true, html: r => W.esc(C.round1(r.disc) + '%') }], done, { empty: 'Нет решений', onrow: r => { location.href = W.url('quote') + '#id=' + r.id; } }));
    }
    function load() { return W.loadQuotes().then(q => { quotes = q; render(); }).catch(W.fail); }
    W.mount(() => W.loadModel().then(m => { M = m; return W.loadQuotes(); }).then(q => { quotes = q; render(); }));
})();
