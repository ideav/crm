/* Диспетчеризация: экран «Объекты» (первый клик демо). Аптеки, склад, машины со статусом «норма / предупреждение / тревога» и лента событий. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    function tile(M, o) {
        var st = C.objectState(o.name, M.alarms), worst = st.open.filter(function (a) { return a.cls === st.state; })[0];
        var zones = M.zones.filter(function (z) { return z.obj === o.name; });
        var temps = zones.map(function (z) { var s = M.sensors.filter(function (x) { return x.zone === z.name; })[0]; return z.name + ' ' + (s ? P.deg(s.last) : ''); }).join(' · ');
        var label = st.state === 'Норма' ? 'норма' : st.state.toLowerCase() + (worst ? ' ' + worst.code + ', ' + C.durText(P.NOW - C.stamp(worst.date, worst.time)) : '');
        return P.el('button', { type: 'button', 'class': 'dsp-tile dsp-s-' + (P.OBJ_CLS[st.state] || 'work'), title: o.address, onclick: function () { if (worst) P.alarmCard(M, worst); else location.href = P.nav('alarms', 'obj=' + encodeURIComponent(o.name)); } }, [
            P.el('b', { text: o.name }), P.el('small', { text: o.type + ', ' + (o.hours ? 'работает ' + o.hours : 'круглосуточно') }),
            P.el('div', { 'class': 'dsp-st', text: label }),
            worst && !worst.acceptTime ? P.el('small', { text: 'отвечает сейчас: ' + P.short(M.esc(worst).who) }) : null,
            P.el('small', { text: temps })
        ]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var open = M.alarms.filter(C.isOpen), states = M.objs.map(function (o) { return C.objectState(o.name, M.alarms).state; });
        var notAcc = open.filter(function (a) { return !a.acceptTime; });
        var overdue = notAcc.filter(function (a) { return M.esc(a).state === 'overdue'; });
        var month = C.journal(M.alarms, M.acts || [], function (a) { return M.modeOfZone(a.zone); }, '2026-11-01', P.TODAY);
        var duty = function (line) { return P.short(C.onDuty(M.duties, line, P.TODAY, P.CLOCK)) || 'нет в графике'; };
        host.appendChild(P.el('div', {}, P.head('Объекты', C.toDmy(P.TODAY) + ', данные регистраторов на ' + P.CLOCK + '. ' + M.shift.shift + ' смена диспетчерской: диспетчер ' + duty('1') + ', дежурный инженер ' + duty('2').replace(/\.$/, '') + '.')));
        var bar = P.el('div', { 'class': 'dsp-bar' }, [P.el('div', { 'class': 'dsp-grow' })]);
        if (P.canWrite('Отклонение датчика') && P.canWrite('Тревога')) bar.appendChild(P.btn('Имитация регистратора', function () { P.gatewayDialog(M); }));
        bar.appendChild(P.el('a', { 'class': 'dsp-btn', href: P.nav('alarms'), text: 'Все тревоги' }));
        host.appendChild(bar);
        host.appendChild(P.el('div', { 'class': 'dsp-kpis' }, [
            P.kpi('объектов в норме', String(states.filter(function (s) { return s === 'Норма' || s === 'Открытая дверь'; }).length), 'из ' + M.objs.length, 'good'),
            P.kpi('в тревоге', String(states.filter(function (s) { return s === 'Тревога'; }).length), 'предупреждений: ' + states.filter(function (s) { return s === 'Предупреждение'; }).length, states.indexOf('Тревога') >= 0 ? 'bad' : 'good'),
            P.kpi('не принято', String(notAcc.length), overdue.length ? 'срок реакции прошёл: ' + overdue.length : 'все в срок', overdue.length ? 'bad' : notAcc.length ? 'warn' : 'good'),
            M.acts ? P.kpi('тревог без акта', String(month.noAct), 'за ноябрь, из ' + month.alarms, month.noAct ? 'warn' : 'good') : null
        ].filter(Boolean)));
        ['Склад', 'Аптека', 'Рефрижератор'].forEach(function (t) {
            var os = M.objs.filter(function (o) { return o.type === t; }); if (!os.length) return;
            host.appendChild(P.el('h2', { text: t === 'Склад' ? 'Склады' : t === 'Аптека' ? 'Аптеки' : 'Машины-рефрижераторы' }));
            host.appendChild(P.el('div', { 'class': 'dsp-tiles' }, os.map(function (o) { return tile(M, o); })));
        });
        host.appendChild(P.el('h2', { text: 'Лента событий' }));
        host.appendChild(P.el('p', { 'class': 'dsp-muted', text: 'Сверху открытые: не принятые по сроку реакции, ниже закрытые за сегодня. Открытая дверь в пределах допуска тревогой не считается. Тревогу получает ответственный по графику дежурств; не принял за срок - она уходит следующему.' }));
        var feed = M.alarms.filter(function (a) { return C.isOpen(a) || a.date === P.TODAY || a.closeDate === P.TODAY; }).sort(function (x, y) {
            var ox = C.isOpen(x) ? (x.acceptTime ? 1 : 0) : 2, oy = C.isOpen(y) ? (y.acceptTime ? 1 : 0) : 2;
            return ox - oy || C.stamp(y.date, y.time) - C.stamp(x.date, x.time);
        });
        host.appendChild(P.table(P.alarmCols(M), feed, { onrow: function (a) { P.alarmCard(M, a); }, rowCls: function (a) { return P.rowCls(M, a); }, empty: 'Событий нет' }));
    }
    P.mount(render);
})();
