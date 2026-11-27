/* MDC: Инциденты. Журнал с отбором по периоду, участку, правилу и причине; карточка - принять, назначить, причина, закрыть, заявка. */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    var st = { tab: 'open', section: '', rule: '', cause: '' };
    function inTab(i) {
        if (st.tab === 'open') return C.isOpen(i);
        if (st.tab === 'today') return i.date === P.TODAY;
        return true;
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Инциденты', 'Журнал за неделю 19.11-26.11.2026. Инцидент закрывается только с причиной из справочника - так причины простоев становятся кодами, а не свободным текстом.')));
        host.appendChild(P.tabs([['open', 'Открытые (' + M.incidents.filter(C.isOpen).length + ')'], ['today', 'Сегодня'], ['week', 'Неделя']], st.tab, function (t) { st.tab = t; render(host, M); }));
        var secSel = P.select([['', 'Все участки']].concat(M.sections.map(function (s) { return s.name; })), st.section);
        var ruleSel = P.select([['', 'Все правила']].concat(M.rules.map(function (r) { return r.name; })), st.rule);
        var causeSel = P.select([['', 'Любая причина'], ['-', 'Без кода причины']].concat(M.causeNames), st.cause);
        secSel.onchange = function () { st.section = secSel.value; render(host, M); };
        ruleSel.onchange = function () { st.rule = ruleSel.value; render(host, M); };
        causeSel.onchange = function () { st.cause = causeSel.value; render(host, M); };
        var rows = M.incidents.filter(function (i) {
            return inTab(i) && (!st.section || i.section === st.section) && (!st.rule || i.rule === st.rule) && (!st.cause || (st.cause === '-' ? !i.cause : i.cause === st.cause));
        });
        var sections = {}; M.incidents.forEach(function (i) { sections[i.section] = 1; });
        host.appendChild(P.el('div', { 'class': 'mdc-bar' }, [Object.keys(sections).length > 1 ? P.field('Участок', secSel) : P.el('div', { 'class': 'mdc-muted', text: 'Участок: ' + (Object.keys(sections)[0] || '-') + ' (по вашей роли)' }), P.field('Правило', ruleSel), P.field('Причина', causeSel), P.el('div', { 'class': 'mdc-grow' }), P.el('div', { 'class': 'mdc-muted', text: 'Найдено: ' + rows.length })]));
        var list = C.feedOrder(rows, M.ruleBy, P.NOW).map(function (x) { return x.inc; });
        host.appendChild(P.table(P.incCols(M), list.slice(0, 300), { onrow: function (i) { P.incidentCard(M, i); }, rowCls: function (i) { return P.incRowCls(M, i); }, empty: 'Инцидентов нет' }));
        if (list.length > 300) host.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Показаны первые 300 из ' + list.length + '; сузьте отбор.' }));
        var h = P.hash(); if (h.code && M.incBy[h.code]) { var i = M.incBy[h.code]; location.hash = ''; P.incidentCard(M, i); }
    }
    P.mount(render);
})();
