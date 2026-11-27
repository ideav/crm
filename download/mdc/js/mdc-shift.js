/* MDC: Экран смены (первый клик демо). Оборудование со статусами по участкам и лента инцидентов: причина, ответственный, таймер реакции, заявка. */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    function tile(M, e) {
        var st = C.equipmentState(e, M.incidents), cls = P.EQ_CLS[st.status] || 'work', i = st.incident;
        var since = '';
        if (st.status !== 'Работает') {
            var from = i && C.isOpen(i) ? C.stamp(i.date, i.time) - (st.status === 'Простой' ? (P.ruleOf(M, i).minutes || 0) : 0) : C.stamp(e.sinceDate || P.TODAY, e.since);
            since = ' ' + C.durText(P.NOW - from);
        }
        return P.el('button', { type: 'button', 'class': 'mdc-tile mdc-s-' + cls, title: e.title + ', ' + e.model, onclick: function () { if (i && C.isOpen(i)) P.incidentCard(M, i); else location.href = P.nav('equipment', 'eq=' + encodeURIComponent(e.name)); } }, [
            P.el('b', { text: e.name }), P.el('small', { text: e.title }),
            P.el('div', { 'class': 'mdc-st', text: st.status + since }),
            i && C.isOpen(i) ? P.el('small', { text: i.code + ': ' + (i.cause || 'нет кода причины') }) : null
        ]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var today = M.incidents.filter(function (i) { return i.date === P.TODAY || C.isOpen(i); });
        var open = M.incidents.filter(C.isOpen);
        var overdue = open.filter(function (i) { return C.reaction(i, P.ruleOf(M, i), P.NOW).state === 'overdue'; });
        var noCause = open.filter(function (i) { return !i.cause; });
        var states = M.eqs.map(function (e) { return C.equipmentState(e, M.incidents).status; });
        var cnt = function (s) { return states.filter(function (x) { return x === s; }).length; };
        host.appendChild(P.el('div', {}, P.head('Экран смены', C.toDmy(P.TODAY) + ', ' + M.shift.shift.toLowerCase() + ' смена 08:00-20:00, данные шлюза на ' + P.CLOCK + '. Дежурные: ' + M.sections.map(function (s) { return s.name + ' - ' + P.short(M.onDuty(s.name) || 'нет в графике'); }).join(', ').replace(/\.?$/, '.'))));
        var bar = P.el('div', { 'class': 'mdc-bar' }, [P.el('div', { 'class': 'mdc-grow' })]);
        if (P.canWrite('Отклонение параметра') && P.canWrite('Инцидент')) bar.appendChild(P.btn('Имитация шлюза', function () { P.gatewayDialog(M); }));
        bar.appendChild(P.el('a', { 'class': 'mdc-btn', href: P.nav('incidents'), text: 'Все инциденты' }));
        host.appendChild(bar);
        host.appendChild(P.el('div', { 'class': 'mdc-kpis' }, [
            P.kpi('работает', String(cnt('Работает')), 'из ' + M.eqs.length + ' единиц', 'good'),
            P.kpi('простой и авария', String(cnt('Простой') + cnt('Авария')), cnt('Плановый простой') ? 'ещё плановый простой: ' + cnt('Плановый простой') : null, cnt('Авария') ? 'bad' : 'warn'),
            P.kpi('открытых инцидентов', String(open.length), 'сегодня всего: ' + M.incidents.filter(function (i) { return i.date === P.TODAY; }).length),
            P.kpi('реакция просрочена', String(overdue.length), overdue.length ? 'эскалация мастеру участка' : 'все в срок', overdue.length ? 'bad' : 'good'),
            P.kpi('без кода причины', String(noCause.length), 'закрыть без причины нельзя', noCause.length ? 'warn' : 'good')
        ]));
        M.sections.forEach(function (s) {
            var eqs = M.eqs.filter(function (e) { return e.section === s.name; });
            if (!eqs.length) return;
            host.appendChild(P.el('div', { 'class': 'mdc-secttl' }, [P.el('h2', { text: s.name }), P.el('span', { 'class': 'mdc-muted', text: 'мастер ' + P.short(s.master) + ', дежурный ' + P.short(M.onDuty(s.name)) })]));
            host.appendChild(P.el('div', { 'class': 'mdc-tiles' }, eqs.map(function (e) { return tile(M, e); })));
        });
        host.appendChild(P.el('h2', { text: 'Лента инцидентов' }));
        host.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Сверху открытые по срочности, ниже закрытые за сегодня. Инцидент создаёт правило из справочника «Правила тревог», ответственный - дежурный участка по графику, заявку на ремонт правило создаёт само, если так настроено.' }));
        var feed = C.feedOrder(today, M.ruleBy, P.NOW).map(function (x) { return x.inc; }).slice(0, 40);
        host.appendChild(P.table(P.incCols(M, [{ t: 'Заявка', html: function (i) { var p = M.repairByInc[i.code]; return p ? P.esc(p.code) + '<br>' + P.badge(p.status, P.REP_KIND[p.status]) : ''; } }]), feed, { onrow: function (i) { P.incidentCard(M, i); }, rowCls: function (i) { return P.incRowCls(M, i); }, empty: 'Инцидентов нет' }));
    }
    P.mount(render);
})();
