/* MDC: Заявки на ремонт. Созданы правилом или диспетчером из инцидента; ремонтная служба ведёт статус и пишет, что сделано. */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    var st = { tab: 'active' };
    var STATUSES = ['Новая', 'В работе', 'Ожидает запчасть', 'Выполнена'];
    function card(M, p) {
        var can = P.canWrite('Заявка на ремонт');
        var status = P.select(STATUSES, p.status), worker = P.select([['', 'не назначен']].concat(M.emps.map(function (e) { return [e.name, e.name + ' - ' + e.position]; })), p.worker || '');
        var done = P.el('textarea', { rows: 3 }); done.value = p.done || '';
        var date = P.input('date', p.doneDate || '');
        [status, worker, done, date].forEach(function (c) { c.disabled = !can; });
        var i = M.incBy[p.incident];
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'mdc-kv' }, [P.el('span', { text: 'Оборудование' }), P.el('span', { html: '<b>' + P.esc(p.eq) + '</b> ' + P.esc((M.eqBy[p.eq] || {}).title || '') })]),
            P.el('div', { 'class': 'mdc-kv' }, [P.el('span', { text: 'Инцидент' }), P.el('span', { html: i ? '<a href="' + P.nav('incidents', 'code=' + encodeURIComponent(i.code)) + '">' + P.esc(i.code) + '</a> ' + P.esc(i.rule) + ', ' + P.esc(C.toDmy(i.date) + ' ' + i.time) : P.esc(p.incident || '-') })]),
            P.el('div', { 'class': 'mdc-kv' }, [P.el('span', { text: 'Важность' }), P.el('span', { html: P.badge(p.severity, P.SEV_KIND[p.severity]) })]),
            P.el('p', { text: p.text || '' }),
            P.el('div', { 'class': 'mdc-grid2' }, [P.field('Статус', status), P.field('Исполнитель', worker), P.field('Дата выполнения', date)]),
            P.field('Что сделано', done)]);
        P.modal('Заявка ' + p.code, body, [{ text: 'Закрыть окно' }, can ? { text: 'Сохранить', cls: 'mdc-primary', fn: function (close) {
            var f = { 'Статус заявки': status.value, 'Что сделано': done.value, 'Дата выполнения': date.value || (status.value === 'Выполнена' ? P.TODAY : '') };
            if (worker.value) f['Исполнитель'] = worker.value;
            P.update(p.id, f).then(function () { P.toast('Заявка ' + p.code + ' сохранена'); close(); P.refresh(); }, function (er) { P.toast(er.message, true); });
            return false;
        } } : null], true);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Заявки на ремонт', 'Заявку создаёт правило тревоги (аварии, перегрев, вибрация) или диспетчер из карточки инцидента: оборудование, участок, важность и описание подтягиваются из инцидента.')));
        if (!M.repairs) { host.appendChild(P.el('div', { 'class': 'mdc-error', text: 'Заявки закрыты для вашей роли.' })); return; }
        var active = M.repairs.filter(function (p) { return p.status !== 'Выполнена'; });
        host.appendChild(P.tabs([['active', 'В работе (' + active.length + ')'], ['all', 'Все (' + M.repairs.length + ')']], st.tab, function (t) { st.tab = t; render(host, M); }));
        var rows = (st.tab === 'active' ? active : M.repairs).slice().sort(function (a, b) { return C.sevRank(b.severity) - C.sevRank(a.severity) || (a.date < b.date ? 1 : -1); });
        host.appendChild(P.table([
            { t: 'Заявка', html: function (p) { return '<b>' + P.esc(p.code) + '</b><br>' + P.badge(p.severity, P.SEV_KIND[p.severity]); } },
            { t: 'Дата', html: function (p) { return P.esc(C.toDmy(p.date)); } },
            { t: 'Оборудование', html: function (p) { return '<b>' + P.esc(p.eq) + '</b> <span class="mdc-muted">' + P.esc(p.section) + '</span>'; } },
            { t: 'Инцидент', k: 'incident' },
            { t: 'Описание', html: function (p) { return P.esc(p.text) + (p.done ? '<br><span class="mdc-muted">' + P.esc(p.done) + '</span>' : ''); } },
            { t: 'Исполнитель', html: function (p) { return P.esc(P.short(p.worker)); } },
            { t: 'Статус', html: function (p) { return P.badge(p.status, P.REP_KIND[p.status]); } }
        ], rows, { onrow: function (p) { card(M, p); }, rowCls: function (p) { return p.status === 'Новая' && p.severity === 'Авария' ? 'mdc-row-bad' : ''; }, empty: 'Заявок нет' }));
        var h = P.hash(); var hit = h.code && M.repairs.filter(function (p) { return p.code === h.code; })[0]; if (hit) { location.hash = ''; card(M, hit); }
    }
    P.mount(render);
})();
